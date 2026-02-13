import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"

export default async function ProtectedPage() {
    const supabase = await createClient()
    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        redirect("/")
    }

    return (
        <div style={{ padding: 32 }}>
            <h1>Welcome, {user.email}</h1>
        </div>
    )
}
