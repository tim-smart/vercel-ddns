import { Context, Effect, flow, Layer, Schedule } from "effect"
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "@effect/platform"
import { NodeHttpClient } from "@effect/platform-node"
import * as Schema from "@effect/schema/Schema"

const make = Effect.gen(function* () {
  const client = (yield* HttpClient.HttpClient).pipe(
    HttpClient.mapRequest(
      flow(
        HttpClientRequest.prependUrl("https://api.ipify.org"),
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

  const getCurrentIp = HttpClientRequest.get("/").pipe(
    HttpClientRequest.setUrlParams({ format: "json" }),
    client,
    HttpClientResponse.schemaBodyJsonScoped(IpResponse),
    Effect.orDie,
  )

  return { getCurrentIp } as const
})

export class Ipify extends Context.Tag("Ipify")<
  Ipify,
  Effect.Effect.Success<typeof make>
>() {
  static Live = Layer.effect(Ipify, make).pipe(
    Layer.provide(NodeHttpClient.layerUndici),
  )
}

const IpResponse = Schema.Struct({
  ip: Schema.String,
})
