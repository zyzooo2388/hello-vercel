import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import UploadClient from "./UploadClient"

export default async function UploadPage() {
    const supabase = await createClient()
    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        redirect("/login?next=/upload")
    }

    return <UploadClient />
}
