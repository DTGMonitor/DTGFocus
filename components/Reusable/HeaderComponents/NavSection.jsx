"use client";

import React from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { getIconComponent } from "../IconMapper";
// .menu-button / .menu-button--active live here. Imported from the component
// that uses them rather than from each page, so a client page gets the tab
// styling without having to know it comes from the admin stylesheet.
import "../../admin/adminpagestyle.css";

function toProperTitleCase(str) {
    const lowerWords = ["a", "an", "the", "and", "but", "or", "for", "nor", "on", "at", "to", "from", "by", "in", "of"];
    return str
        .toLowerCase()
        .split(" ")
        .map((word, index) =>
            index === 0 || !lowerWords.includes(word)
                ? word.charAt(0).toUpperCase() + word.slice(1)
                : word
        )
        .join(" ");
}

/**
 * The tab strip under the logo. Two modes, because the two halves of the app
 * navigate differently:
 *
 *   default  a state switch. The parent owns `activeComponent` and swaps the
 *            body itself (admin/Radar/Radar.jsx, InSar/Insar.jsx). Items carry
 *            a `key`; `path` is never read.
 *   routed   a router. Each item's `path` is a real route, `:client` is filled
 *            in from the [client] param, and the active tab is whichever path
 *            the URL is on. This is what the client dashboard uses, matching
 *            the deployed build.
 *
 * The mode is explicit rather than inferred from which props are present: the
 * admin Safety pages pass menuItems and no handler, and silently turning those
 * into links would route them at paths that do not exist.
 */
const NavSection = ({ menuItems, activeComponent, onMenuClick, routed = false }) => {
    const router = useRouter();
    const pathname = usePathname();
    const params = useParams();
    const client = params?.client;

    const resolvePath = (path) => String(path ?? "").replace(":client", client ?? "");

    const isActive = (item) =>
        routed ? pathname === resolvePath(item.path) : activeComponent === item.key;

    const handleClick = (item) => {
        if (routed) {
            router.push(resolvePath(item.path));
            return;
        }
        onMenuClick?.(item.key);
    };

    return (
        <div
            className="flex items-center gap-20 w-full bg-[var(--dtg-bg-card)] text-[var(--dtg-text-light)] border-t-1 border-b-2 border-[var(--dtg-border-dark)]"

        >
            {menuItems.map((item) => {
                const Icon = getIconComponent(item.icon);

                return (
                    <button
                        key={item.label}
                        type="button"
                        onClick={() => handleClick(item)}
                        className={`menu-button ${isActive(item) ? 'menu-button--active' : ''}`}
                    >
                        {Icon && <Icon size={18} />}
                        {toProperTitleCase(item.label)}
                    </button>
                );
            })}
        </div>
    );
};

export default NavSection;
