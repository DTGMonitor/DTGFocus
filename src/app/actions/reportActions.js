// src/app/actions/reportActions.js
'use server';

import {supabaseServer} from "@/lib/supaBaseServer";
import { revalidatePath } from "next/cache";

export async function createReportRecord(reportData) {
  try {
    // 1. Insert the record using the secure server client
    const { data, error } = await supabaseServer
      .from('reports')
      .insert([reportData])
      .select();

    if (error) {
      console.error("Supabase Error:", error);
      throw new Error(error.message);
    }

    // 2. Revalidate the path to refresh the UI
    // CHANGE THIS STRING if your reports list is on a different route (e.g. '/admin/reports')
    revalidatePath('/dashboard'); 
    
    // If you have reports showing on multiple pages (e.g. client view AND admin view),
    // you can revalidate them both:
    // revalidatePath('/admin/reports');
    // revalidatePath(`/clients/${reportData.client_id}`);

    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}