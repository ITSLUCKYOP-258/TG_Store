/**
 * SQLite loader: uses Node's built-in `node:sqlite` (DatabaseSync) when
 * available (Node 22.5+ / Node 24), and falls back to `better-sqlite3`.
 *
 * Why this exists: on some Windows machines an Application Control / WDAC
 * policy blocks the `better_sqlite3.node` native binary from loading
 * ("An Application Control policy has blocked this file", ERR_DLOPEN_FAILED).
 * `node:sqlite` is compiled into the Node executable itself, so it is never
 * blocked by such policies and needs no rebuild toolchain.
 */

let Database;
let DatabaseSync;

try {
  const mod = await import('node:sqlite');
  DatabaseSync = mod.DatabaseSync;
} catch {
  // node:sqlite not available on older Node versions
}

if (!DatabaseSync) {
  const betterSqlite = await import('better-sqlite3');
  Database = betterSqlite.default;
} else {
  // Normalize bound parameters to the value types node:sqlite accepts
  // (null | number | bigint | string | Uint8Array).
  function normalizeParams(params) {
    return params.map((p) => {
      if (p === undefined) return null;
      if (typeof p === 'boolean') return p ? 1 : 0;
      if (p instanceof Date) return p.toISOString();
      return p;
    });
  }

  function wrapStatement(stmt) {
    return {
      get(...params) {
        return stmt.get(...normalizeParams(params));
      },
      all(...params) {
        return stmt.all(...normalizeParams(params));
      },
      run(...params) {
        const res = stmt.run(...normalizeParams(params));
        return {
          changes: res.changes,
          // better-sqlite3 returns lastInsertRowid as a plain number for the
          // small ids this app uses; node:sqlite may hand back a bigint, so
          // coerce to keep downstream `.get(lastInsertRowid)` working.
          lastInsertRowid:
            typeof res.lastInsertRowid === 'bigint'
              ? Number(res.lastInsertRowid)
              : res.lastInsertRowid,
        };
      },
    };
  }

  Database = class Database {
    constructor(filePath) {
      this._db = new DatabaseSync(filePath);
    }

    pragma(source) {
      // Run the PRAGMA (side effects like WAL / foreign_keys still apply).
      this._db.exec(`PRAGMA ${source}`);
      return undefined;
    }

    exec(sql) {
      return this._db.exec(sql);
    }

    prepare(sql) {
      return wrapStatement(this._db.prepare(sql));
    }

    transaction(fn) {
      const self = this;
      return function transacted(...args) {
        self._db.exec('BEGIN');
        try {
          const result = fn.apply(this, args);
          self._db.exec('COMMIT');
          return result;
        } catch (err) {
          try {
            self._db.exec('ROLLBACK');
          } catch {
            /* ignore rollback failure */
          }
          throw err;
        }
      };
    }

    close() {
      this._db.close();
    }
  };
}

export default Database;
