import {
  Config,
  Context,
  Effect,
  flow,
  Layer,
  Option,
  Redacted,
  Schedule,
  Stream,
  Struct,
} from "effect"
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "@effect/platform"
import { NodeHttpClient } from "@effect/platform-node"
import { configProviderNested } from "./Utils.js"
import * as Schema from "@effect/schema/Schema"

const make = Effect.gen(function* () {
  const token = yield* Config.redacted("token")
  const client = (yield* HttpClient.HttpClient).pipe(
    HttpClient.mapRequest(
      flow(
        HttpClientRequest.bearerToken(Redacted.value(token)),
        HttpClientRequest.prependUrl("https://api.vercel.com"),
        HttpClientRequest.acceptJson,
      ),
    ),
    HttpClient.filterStatusOk,
    HttpClient.transformResponse(
      Effect.retry({
        while: (err) =>
          err._tag === "ResponseError" && err.response.status >= 429,
        times: 5,
        schedule: Schedule.exponential(100),
      }),
    ),
  )

  const listDnsRecordsPage = (options: {
    readonly domain: string
    readonly since?: number
  }) =>
    HttpClientRequest.get(`/v4/domains/${options.domain}/records`).pipe(
      HttpClientRequest.setUrlParams({
        limit: 50,
        since: options.since,
      }),
      client,
      HttpClientResponse.schemaBodyJsonScoped(RecordsPage),
    )

  const listDnsRecords = (options: { readonly domain: string }) =>
    Stream.paginateChunkEffect(undefined as undefined | number, (since) =>
      listDnsRecordsPage({
        domain: options.domain,
        since,
      }).pipe(
        Effect.orDie,
        Effect.map((page) => [page.records, page.pagination.next]),
      ),
    )

  const createRecord = (record: {
    readonly domain: string
    readonly name: string
    readonly type: string
    readonly value: string
  }) =>
    HttpClientRequest.post(`/v2/domains/${record.domain}/records`).pipe(
      HttpClientRequest.unsafeJsonBody(Struct.omit(record, "domain")),
      client,
      HttpClientResponse.void,
    )

  const updateRecord = (update: {
    readonly id: string
    readonly value: string
  }) =>
    HttpClientRequest.patch(`/v1/domains/records/${update.id}`).pipe(
      HttpClientRequest.unsafeJsonBody(Struct.omit(update, "id")),
      client,
      HttpClientResponse.void,
    )

  const upsertRecord = (options: {
    readonly domain: string
    readonly subdomain: string
    readonly type: string
    readonly value: string
  }) =>
    Effect.gen(function* () {
      const existing = yield* listDnsRecords({ domain: options.domain }).pipe(
        Stream.filter(
          (record) =>
            record.type === options.type && record.name === options.subdomain,
        ),
        Stream.runHead,
      )
      if (Option.isSome(existing)) {
        const record = existing.value
        if (record.value === options.value) {
          return
        }
        yield* updateRecord({ id: record.id, value: options.value })
      } else {
        yield* createRecord({
          domain: options.domain,
          name: options.subdomain,
          type: options.type,
          value: options.value,
        })
      }
    })

  return { listDnsRecords, createRecord, updateRecord, upsertRecord } as const
}).pipe(Effect.withConfigProvider(configProviderNested("vercel")))

export class Vercel extends Context.Tag("Vercel")<
  Vercel,
  Effect.Effect.Success<typeof make>
>() {
  static Live = Layer.effect(Vercel, make).pipe(
    Layer.provide(NodeHttpClient.layerUndici),
  )
}

export class Record extends Schema.Class<Record>("Record")({
  id: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  type: Schema.String,
  value: Schema.String,
  creator: Schema.String,
  created: Schema.Number,
  updated: Schema.Number,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  ttl: Schema.optionalWith(Schema.Number, { nullable: true, as: "Option" }),
  comment: Schema.optionalWith(Schema.String, { nullable: true, as: "Option" }),
  mxPriority: Schema.optionalWith(Schema.Number, {
    nullable: true,
    as: "Option",
  }),
}) {}

export class Pagination extends Schema.Class<Pagination>("Pagination")({
  count: Schema.Number,
  next: Schema.optionalWith(Schema.Number, { nullable: true, as: "Option" }),
  prev: Schema.optionalWith(Schema.Number, { nullable: true, as: "Option" }),
}) {}

export class RecordsPage extends Schema.Class<RecordsPage>("RecordsPage")({
  records: Schema.Chunk(Record),
  pagination: Pagination,
}) {}
