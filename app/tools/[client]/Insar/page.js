"use client";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Legacy route. The InSAR card opens Water Body directly (as the deployed build
 * does), and WB_insar now carries the InSAR header itself — rendering the old
 * Insar.jsx tab container here would stack a second logo and tab strip on top.
 * Kept as a redirect so existing links still land somewhere sensible.
 */
export default function Page() {
  const router = useRouter();
  const { client } = useParams();

  useEffect(() => {
    router.replace(`/tools/${client}/WB_insar`);
  }, [router, client]);

  return null;
}
