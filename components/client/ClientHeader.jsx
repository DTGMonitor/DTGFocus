"use client";

import React from "react";
import LogoSection from "@/components/Reusable/HeaderComponents/LogoSection";
import NavSection from "@/components/Reusable/HeaderComponents/NavSection";

/**
 * Logo + tab strip, on every client page that belongs to a tab set.
 *
 * The deployed build repeats this pair inside each page component; here it is
 * one component so the two client tab sets (radar, InSAR) cannot drift apart.
 * The logo half is deliberately the repo's own LogoSection — the FOCUS header,
 * not the deployed one.
 */
export default function ClientHeader({ subtitle = "Radar", menuItems }) {
    return (
        <div className="flex flex-col shrink-0 bg-[var(--dtg-bg-primary)]">
            <LogoSection Subtitle={subtitle} />
            <NavSection menuItems={menuItems} routed />
        </div>
    );
}
