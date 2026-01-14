// hooks/useUserSite.js
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export function useUserSite() {
    const [userSite, setUserSite] = useState(null);
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            const { data: { user: authUser } } = await supabase.auth.getUser();
            if (!authUser) {
                setUserSite(null);
                setLoading(false);
                return;
            }
            setUser(authUser);


            // Fetch user site & role
            const { data, error } = await supabase
                .from("user_sites")
                .select(`
          role,
          displayname,
          user_id,
          site:clients (
            id,
            site_name,
            location,
            company,
            logo_path
          )
        `)
                .eq("user_id", authUser.id)
                .maybeSingle();

            console.log("authUser", authUser);
            if (error) {
                console.error("Error fetching user site:", error);
                setUserSite(null);
            } else {
                setUserSite(data);
            }
            setLoading(false);
        };

        load();
    }, []);

    return { user, userSite, loading };
}
