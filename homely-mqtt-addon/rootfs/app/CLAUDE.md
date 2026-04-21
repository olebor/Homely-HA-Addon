# CLAUDE.md — homely-mqtt-addon / rootfs / app

## Package manager

**npm**, not yarn. The global developer profile prefers yarn, but this project
is pinned to npm: `package-lock.json` is checked in, the Dockerfile runs
`npm install --sqlite=/usr/local`, and the build scripts use npm. Don't
introduce yarn here.

Node: 18.x (see `"engines"` in `package.json`). Vitest is pinned to the 1.x
line for Node 18 compatibility — do not upgrade to 2.x/3.x without bumping
Node as well.

## Tests

Framework: **Vitest**. Tests live **alongside** their source file
(`utils/retry.ts` → `utils/retry.test.ts`). Shared helpers and fixtures live
under `__test__/`.

Run from `homely-mqtt-addon/rootfs/app/`:

```sh
npm test                # one-shot
npm run test:watch      # watch mode
npm run test:coverage   # with @vitest/coverage-v8
```

### TypeScript

`tsconfig.json` has a narrow `"files": ["./index.ts", "index.ts"]` array, so
tests are **already excluded from the production `tsc` build**. Do not add
tests to `files`/`include`. Vitest uses its own esbuild-based transformer.

### What NOT to test (yet)

Configuration and side-effectful setup code. Skip unless the logic grows:

- `sensors/**/*.ts` — declarative sensor catalogs; covered transitively by
  `entities/discover.test.ts` running against the real `sensors` array.
- `models/*.ts` — type-only modules.
- `db/connection.ts` — sequelize bootstrap.
- `utils/mqtt.ts` — connect/will/publish bootstrap; mock its exported
  `mqttClient` instead.
- `utils/logger.ts` — pino wiring.

### Mocking patterns

Several source modules read `config.get(...)` or connect to the outside world
**at module load time**. You must `vi.mock(...)` *before* importing them, then
import dynamically inside the test (or at the top, after `vi.mock`, which
vitest hoists).

- **`config`** — use `__test__/mock-config.ts`:
  ```ts
  import { buildConfigMock } from '../__test__/mock-config';
  vi.mock('config', () => buildConfigMock({ homely: { host: '…' } }));
  ```
  The mock throws on unknown keys so missing config is loud, not silent.

- **`node-fetch`** — default export; cast resolved values to the response
  shape the caller uses (`json()`, `text()`, `headers.get()`, `status`).
  ```ts
  vi.mock('node-fetch', () => ({ default: vi.fn() }));
  ```

- **MQTT** — prefer mocking the wrapper, not the raw package:
  ```ts
  vi.mock('../utils/mqtt', () => ({ mqttClient: { publish: vi.fn() } }));
  ```

- **Logger** — silence pino so CI output stays clean:
  ```ts
  vi.mock('../utils/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() } }));
  ```

### Singletons

`homely/auth.ts` exports a singleton `authenticator` that caches token state
on the module instance. To get a fresh instance per test:

```ts
const loadAuth = async () => {
  vi.resetModules();
  return await import('./auth');
};
```

### Deterministic time & randomness

- `utils/retry.ts` uses `setTimeout` + `Math.random` for jittered exponential
  backoff. Use `vi.useFakeTimers()` and `vi.spyOn(Math, 'random')` to control
  both; advance the clock with `vi.advanceTimersByTimeAsync`.
- `homely/auth.ts` computes `exp = Date.now() + expires_in * 1000`. Use
  `vi.setSystemTime(...)` so assertions on `exp` are stable.

### `process.exit`

`publish-entity-changes.ts` calls `process.exit()` to halt the loop on a
missing device. Tests substitute a throw so control flow mimics process
termination:

```ts
vi.spyOn(process, 'exit').mockImplementation((() => {
  throw new Error('__test_process_exit__');
}) as never);
```

### Docker image

`.dockerignore` excludes `**/*.test.ts`, `__test__/`, `vitest.config.ts`,
and `coverage/`. Tests are never shipped in the image.
