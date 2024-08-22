import { Config, Effect, Layer, Logger } from "effect"
import { Vercel } from "./Vercel.js"
import { Ipify } from "./Ipify.js"
import { NodeRuntime } from "@effect/platform-node"

const program = Effect.gen(function* () {
  const vercel = yield* Vercel
  const ipify = yield* Ipify
  const domain = yield* Config.string("DDNS_DOMAIN")
  const subdomains = yield* Config.string("DDNS_SUBDOMAIN").pipe(Config.array)
  const ipAddress = yield* ipify.getCurrentIp

  yield* Effect.forEach(
    subdomains,
    (subdomain) =>
      Effect.log(`Processing ${subdomain}.${domain}...`).pipe(
        Effect.andThen(
          vercel.upsertRecord({
            domain,
            subdomain,
            type: "A",
            value: ipAddress.ip,
          }),
        ),
      ),
    { concurrency: 5 },
  )
}).pipe(Effect.tapErrorCause(Effect.logFatal))

const EnvLive = Layer.mergeAll(Vercel.Live, Ipify.Live).pipe(
  Layer.provideMerge(Logger.pretty),
)

NodeRuntime.runMain(program.pipe(Effect.provide(EnvLive)), {
  disableErrorReporting: true,
})
