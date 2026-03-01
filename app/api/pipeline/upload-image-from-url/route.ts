type UploadImageFromUrlBody = {
    imageUrl?: string;
    isCommonUse?: boolean;
    accessToken?: string;
};

function extractToken(request: Request, body: UploadImageFromUrlBody | null) {
    const authHeader = request.headers.get("authorization") ?? "";
    if (authHeader.toLowerCase().startsWith("bearer ")) {
        return authHeader.slice(7).trim();
    }
    return body?.accessToken?.trim();
}

export async function POST(request: Request) {
    let body: UploadImageFromUrlBody | null = null;
    try {
        body = (await request.json()) as UploadImageFromUrlBody;
    } catch (error) {
        console.error("[pipeline/upload-image-from-url] Invalid JSON body.", error);
        return new Response("Invalid JSON body.", { status: 400 });
    }

    const token = extractToken(request, body);
    if (!token) {
        return new Response("Missing access token.", { status: 401 });
    }

    if (!body?.imageUrl) {
        return new Response("Missing imageUrl.", { status: 400 });
    }

    const upstream = await fetch(
        "https://api.almostcrackd.ai/pipeline/upload-image-from-url",
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                imageUrl: body.imageUrl,
                isCommonUse: body.isCommonUse ?? false,
            }),
        },
    );

    if (!upstream.ok) {
        const errorText = await upstream.text();
        console.error(`[pipeline/upload-image-from-url] ${upstream.status}: ${errorText}`);
        return new Response(errorText, { status: upstream.status });
    }

    const data = await upstream.json();
    return Response.json(data, { status: upstream.status });
}
