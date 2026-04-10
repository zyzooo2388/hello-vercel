import { createClient } from "@/lib/supabase/server"
import LoginRequiredScreen from "@/app/components/LoginRequiredScreen"
import UploadClient from "./UploadClient"

export default async function UploadPage() {
    const supabase = await createClient()
    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        // Auth gate: block upload UI when there is no session.
        return <LoginRequiredScreen />
    }

    return <UploadClient />
}
