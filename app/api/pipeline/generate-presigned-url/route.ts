type GeneratePresignedUrlBody = {
    contentType?: string;
    accessToken?: string;
};

function extractToken(request: Request, body: GeneratePresignedUrlBody | null) {
    const authHeader = request.headers.get("authorization") ?? "";
    if (authHeader.toLowerCase().startsWith("bearer ")) {
        return authHeader.slice(7).trim();
    }
    return body?.accessToken?.trim();
}

export async function POST(request: Request) {
    let body: GeneratePresignedUrlBody | null = null;
    try {
        body = (await request.json()) as GeneratePresignedUrlBody;
    } catch (error) {
        console.error("[pipeline/generate-presigned-url] Invalid JSON body.", error);
        return new Response("Invalid JSON body.", { status: 400 });
    }

    const token = extractToken(request, body);
    if (!token) {
        return new Response("Missing access token.", { status: 401 });
    }

    if (!body?.contentType) {
        return new Response("Missing contentType.", { status: 400 });
    }

    const upstream = await fetch(
        "https://api.almostcrackd.ai/pipeline/generate-presigned-url",
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ contentType: body.contentType }),
        },
    );

    if (!upstream.ok) {
        const errorText = await upstream.text();
        console.error(
            `[pipeline/generate-presigned-url] ${upstream.status}: ${errorText}`,
        );
        return new Response(errorText, { status: upstream.status });
    }

    const data = await upstream.json();
    return Response.json(data, { status: upstream.status });
}
