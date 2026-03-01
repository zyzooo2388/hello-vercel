type GenerateCaptionsBody = {
    imageId?: string;
    accessToken?: string;
};

function extractToken(request: Request, body: GenerateCaptionsBody | null) {
    const authHeader = request.headers.get("authorization") ?? "";
    if (authHeader.toLowerCase().startsWith("bearer ")) {
        return authHeader.slice(7).trim();
    }
    return body?.accessToken?.trim();
}

export async function POST(request: Request) {
    let body: GenerateCaptionsBody | null = null;
    try {
        body = (await request.json()) as GenerateCaptionsBody;
    } catch (error) {
        console.error("[pipeline/generate-captions] Invalid JSON body.", error);
        return new Response("Invalid JSON body.", { status: 400 });
    }

    const token = extractToken(request, body);
    if (!token) {
        return new Response("Missing access token.", { status: 401 });
    }

    if (!body?.imageId) {
        return new Response("Missing imageId.", { status: 400 });
    }

    const upstream = await fetch("https://api.almostcrackd.ai/pipeline/generate-captions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ imageId: body.imageId }),
    });

    if (!upstream.ok) {
        const errorText = await upstream.text();
        console.error(`[pipeline/generate-captions] ${upstream.status}: ${errorText}`);
        return new Response(errorText, { status: upstream.status });
    }

    const data = await upstream.json();
    return Response.json(data, { status: upstream.status });
}
