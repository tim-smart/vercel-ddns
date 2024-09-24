import { Config, Effect, Layer } from "effect"
import { Vercel } from "./Vercel.js"
import { Ipify } from "./Ipify.js"
import { NodeRuntime } from "@effect/platform-node"
import { configProviderNested } from "./Utils.js"

const program = Effect.gen(function* () {
  const vercel = yield* Vercel
  const ipify = yield* Ipify
  const domain = yield* Config.string("domain")
  const subdomains = yield* Config.string("subdomain").pipe(Config.array)
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
}).pipe(
  Effect.withConfigProvider(configProviderNested("ddns")),
  Effect.tapErrorCause(Effect.logFatal),
)

const EnvLive = Layer.mergeAll(Vercel.Live, Ipify.Live)

NodeRuntime.runMain(program.pipe(Effect.provide(EnvLive)), {
  disableErrorReporting: true,
})
