import { Global, Module, type OnApplicationShutdown } from "@nestjs/common";
import { createDatabase, type Database } from "@corpus-lens/db/client";

import { apiEnv } from "../config/env";

/**
 * The Drizzle connection as an injectable provider.
 *
 * Global because every feature module needs it and threading an import through each one
 * is ceremony with no benefit.
 *
 * The connection is created once and closed on shutdown. `createDatabase` deliberately
 * returns a `close` function rather than hiding a singleton (packages/db/src/client.ts),
 * so the owner of the connection has to be explicit — here that owner is this module, and
 * the factory below must hand out the *same* handle the shutdown hook closes. Creating a
 * connection inside the factory instead would leave a second pool open at exit and the
 * process would hang without ever saying why.
 */
export const DATABASE = Symbol("DATABASE");

let handle: { db: Database; close: () => Promise<void> } | undefined;

function connection(): { db: Database; close: () => Promise<void> } {
  handle ??= createDatabase({ url: apiEnv.DATABASE_URL });
  return handle;
}

@Global()
@Module({
  providers: [{ provide: DATABASE, useFactory: (): Database => connection().db }],
  exports: [DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await handle?.close();
    handle = undefined;
  }
}
