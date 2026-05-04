import { Hono } from 'npm:hono';
import { cors } from 'npm:hono/cors';
import { logger } from 'npm:hono/logger';
import * as kv from './kv_store.tsx';
import { createClient } from 'npm:@supabase/supabase-js@2';

const app = new Hono();
app.use('*', cors());
app.use('*', logger(console.log));

// ── Auth: Sign Up ──────────────────────────────────────────────────────────────
app.post('/make-server-8a330b06/auth/signup', async (c) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { email, password, name } = await c.req.json();
    if (!email || !password || !name) {
      return c.json({ error: 'email, password and name are required' }, 400);
    }
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: { name },
      // Automatically confirm the user's email since an email server hasn't been configured.
      email_confirm: true,
    });
    if (error) return c.json({ error: error.message }, 400);
    return c.json({ user: { id: data.user?.id, email: data.user?.email, name } });
  } catch (err) {
    console.log('Signup error:', err);
    return c.json({ error: String(err) }, 500);
  }
});

// ── Canvas snapshot storage for collaborative rooms ───────────────────────────

// Save canvas snapshot for a room
app.post('/make-server-8a330b06/rooms/:roomId/canvas', async (c) => {
  try {
    const { roomId } = c.req.param();
    const body = await c.req.json();
    const { dataUrl } = body;
    if (!dataUrl || typeof dataUrl !== 'string') {
      return c.json({ error: 'dataUrl is required' }, 400);
    }
    // Cap at ~5MB dataUrl
    if (dataUrl.length > 6_000_000) {
      return c.json({ error: 'Canvas too large to sync' }, 413);
    }
    await kv.set(`room:${roomId}:canvas`, { dataUrl, savedAt: Date.now() });
    return c.json({ ok: true });
  } catch (err) {
    console.log('Error saving canvas:', err);
    return c.json({ error: String(err) }, 500);
  }
});

// Get canvas snapshot for a room
app.get('/make-server-8a330b06/rooms/:roomId/canvas', async (c) => {
  try {
    const { roomId } = c.req.param();
    const record = await kv.get(`room:${roomId}:canvas`);
    if (!record) return c.json({ dataUrl: null });
    return c.json({ dataUrl: (record as any).dataUrl ?? null });
  } catch (err) {
    console.log('Error fetching canvas:', err);
    return c.json({ error: String(err) }, 500);
  }
});

// Delete room canvas
app.delete('/make-server-8a330b06/rooms/:roomId/canvas', async (c) => {
  try {
    const { roomId } = c.req.param();
    await kv.del(`room:${roomId}:canvas`);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.get('/make-server-8a330b06/health', (c) => c.json({ ok: true }));

Deno.serve(app.fetch);