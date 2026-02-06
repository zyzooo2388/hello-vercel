import { supabase } from '@/lib/supabaseClient'

export default async function ListPage() {
    const { data, error } = await supabase
        .from('images')
        .select('id, url, image_description')

    if (error) {
        return (
            <div style={{ padding: '2rem' }}>
                <h1>Error</h1>
                <pre>{error.message}</pre>
            </div>
        )
    }

    return (
        <div style={{ padding: '2rem' }}>
            <h1>Images</h1>

            <ul>
                {data?.map((image) => (
                    <li key={image.id} style={{ marginBottom: '1rem' }}>
                        <div><strong>ID:</strong> {image.id}</div>
                        <div><strong>Description:</strong> {image.image_description}</div>
                        <img
                            src={image.url}
                            alt={image.image_description ?? 'image'}
                            style={{ maxWidth: '300px', marginTop: '0.5rem' }}
                        />
                    </li>
                ))}
            </ul>
        </div>
    )
}
