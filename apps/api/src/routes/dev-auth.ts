import type { Hono } from "hono";
import { z } from "zod";
import { mintUserToken } from "../auth";
import { route, type Deps, type Env } from "../http";

const DevLoginBody = z.object({ email: z.email() });

/**
 * Local-only convenience login for development and CI: mints a
 * Supabase-shaped user token for an email, creating the `auth.users` row if
 * needed (no password — this is not an authentication system).
 *
 * Production auth is Supabase's own client-side flow; the API never
 * authenticates a password itself. Call site guards this to never mount
 * outside `env !== "production"` (see registerDevAuth call in app.ts).
 */
export function registerDevAuth(app: Hono<Env>, deps: Deps) {
  route(
    app,
    deps,
    { method: "POST", path: "/v1/dev/login", tag: "Dev", summary: "เข้าสู่ระบบสำหรับพัฒนา/ทดสอบ (ไม่มีรหัสผ่าน ไม่มีใน production)", auth: false, body: DevLoginBody },
    async ({ body }) => {
      const [user] = await deps.sql<{ id: string }[]>`
        insert into auth.users (id, email) values (gen_random_uuid(), ${body.email})
        on conflict (email) do update set email = excluded.email
        returning id`;
      const token = await mintUserToken(deps.config.jwtSecret, user!.id);
      return { token, userId: user!.id };
    },
  );
}
