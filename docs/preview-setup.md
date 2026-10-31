# Arc Studio preview setup

This repository is cloned into a subfolder (`AskirawaFinance/`) of an Arc Studio project. The Live Preview runs
`vite` from the **parent** folder, not from this repository, so the parent needs a small `vite.config.ts` that serves
this app. Without it the preview shows the parent's empty starter page, which is a blank white screen.

This file lives outside the repository, so it is not part of any commit. Recreate it in the parent folder if the
preview goes blank:

```ts
import { defineConfig, mergeConfig } from 'vite'
import path from 'path'
import appConfig from './AskirawaFinance/vite.config'

export default defineConfig(
  mergeConfig(appConfig, {
    root: path.resolve(__dirname, 'AskirawaFinance'),
    envDir: __dirname,
  }),
)
```

- `root` points Vite at this repository.
- `envDir` keeps `VITE_*` values in the parent folder's `.env` (for example `VITE_TREASURY_ADDRESS`) working.
- Keep `server.allowedHosts: true` (it is inherited from this repository's `vite.config.ts`).

This setup only affects the Arc Studio preview. Running this repository on its own (`bun install`, then `bun run dev`
from this folder) does not need it.

Until `VITE_TREASURY_ADDRESS` and the related values are set, the treasury pages show a "Treasury v2 is not configured"
notice. That is expected and not an error.
