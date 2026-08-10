
    const coverMatch = path.match(/^\/playlists\/([^/]+)\/cover$/);

    if (request.method === "PUT" && coverMatch) {

      const username = await requireAuth(request, env);

      if (!username) return json({ success: false, error: "No autorizado" }, 401, corsHeaders);

      try {

        const id       = coverMatch[1];

        const metaKey  = `playlists/${username}/${id}/meta.json`;

        const existing = await env.BUCKET.get(metaKey);

        if (!existing) return json({ success: false, error: "Playlist no encontrada" }, 404, corsHeaders);

        const formData = await request.formData();

        const file     = formData.get("file");

        if (!file) return json({ success: false, error: "Falta el archivo" }, 400, corsHeaders);

        const mime     = file.type || "image/jpeg";

        const ext      = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";

        const coverKey = `playlists/${username}/${id}/cover.${ext}`;

        await env.BUCKET.put(coverKey, await file.arrayBuffer(), { httpMetadata: { contentType: mime } });

        const current  = await existing.json();

        const updated  = { ...current, hasCover: true, coverKey, coverExt: ext, updatedAt: new Date().toISOString() };

        await env.BUCKET.put(metaKey, JSON.stringify(updated), { httpMetadata: { contentType: "application/json" } });

        return json({ success: true, key: coverKey, playlist: updated }, 200, corsHeaders);

      } catch (err) {

        return json({ success: false, error: err.message }, 500, corsHeaders);

      }

    }


    return json({ success: false, error: "Not found" }, 404, corsHeaders);

  }

};


// ── Helpers ────────────────────────────────────────────────────────────────

function extractYtId(url) {

  const m = url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{11})/);

  return m ? m[1] : null;

}

__name(extractYtId, "extractYtId");


function sanitize(str) {

  return str.replace(/[^\w\s\-\.]/g, "").replace(/\s+/g, " ").trim().slice(0, 200);

}

__name(sanitize, "sanitize");


function json(data, status = 200, headers = {}) {

  return new Response(JSON.stringify(data), {

    status,

    headers: { "Content-Type": "application/json", ...headers }

  });

}



__name(json, "json");


export { index_default as default };
