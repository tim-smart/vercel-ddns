import { Effect, flow, pipe, Schedule, Schema } from "effect"
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "@effect/platform"
import { NodeHttpClient } from "@effect/platform-node"

export class Ipify extends Effect.Service<Ipify>()("Ipify", {
  dependencies: [NodeHttpClient.layer],
  effect: Effect.gen(function* () {
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

    const getCurrentIp = pipe(
      client.get("/", { urlParams: { format: "json" } }),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(IpResponse)),
      Effect.scoped,
      Effect.orDie,
    )

    return { getCurrentIp } as const
  }),
}) {}

const IpResponse = Schema.Struct({
  ip: Schema.String,
})
