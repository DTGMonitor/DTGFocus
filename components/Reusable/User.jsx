import React, { useEffect, useLayoutEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { FiLogOut, FiUser, FiSettings } from "react-icons/fi";

/**
 * Popup menu anchored to a button.
 *
 * Props:
 *  - open: boolean (parent controls)
 *  - anchorRef: ref to the element to anchor under
 *  - onClose: () => void
 *  - user, logo (optional display data)
 *  - anchorColor, panelColor, accentColor (theme)
 */
export default function UserDropdown({
    open,
    anchorRef,
    onClose,
    user,
    site,
    logo,
    anchorColor = "#0B514E",
    panelColor = "#1B1B1B",
    accentColor = "#14B8A6"
}) {
    const router = useRouter();
    const panelRef = useRef(null);
    const btnRef = anchorRef; // alias for clarity


    // Position state
    const [pos, setPos] = useState({ top: 0, left: 0 });

    // Compute panel position when opened or on window resize/scroll
    useLayoutEffect(() => {
        if (!open || !btnRef?.current) return;
        const rect = btnRef.current.getBoundingClientRect();

        // Panel dims (fallback guess; we'll update after mount)
        let panelWidth = 240;
        if (panelRef.current) {
            const r = panelRef.current.getBoundingClientRect();
            panelWidth = r.width;
        }

        // Place below-right aligned to anchor's right edge
        const top = rect.bottom + window.scrollY + 8; // 8px gap
        const left = rect.right + window.scrollX - panelWidth;

        setPos({ top, left: Math.max(8, left) }); // keep on-screen
    }, [open, btnRef]);

    // Recalculate on resize/scroll
    useEffect(() => {
        if (!open) return;
        function handle() {
            if (!btnRef?.current) return;
            const rect = btnRef.current.getBoundingClientRect();
            const panelWidth =
                panelRef.current?.getBoundingClientRect().width ?? 240;
            const top = rect.bottom + window.scrollY + 8;
            const left = rect.right + window.scrollX - panelWidth;
            setPos({ top, left: Math.max(8, left) });
        }
        window.addEventListener("resize", handle);
        window.addEventListener("scroll", handle, true);
        return () => {
            window.removeEventListener("resize", handle);
            window.removeEventListener("scroll", handle, true);
        };
    }, [open, btnRef]);

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        function handleClick(e) {
            if (
                panelRef.current &&
                !panelRef.current.contains(e.target) &&
                btnRef?.current &&
                !btnRef.current.contains(e.target)
            ) {
                onClose?.();
            }
        }
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, [open, onClose, btnRef]);

    // Close on Esc
    useEffect(() => {
        if (!open) return;
        function handleKey(e) {
            if (e.key === "Escape") onClose?.();
        }
        document.addEventListener("keydown", handleKey);
        return () => document.removeEventListener("keydown", handleKey);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div
            ref={panelRef}
            style={{
                position: "absolute",
                top: `${pos.top}px`,
                left: `${pos.left}px`,
                backgroundColor: "rgba(42, 42, 42, 1)",
                padding: "2px",
                minWidth: "220px",
                borderRadius: "8px",
                border: "1px solid #3a3a3a",
                boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
                zIndex: 999,
                fontSize: "12px",
                display: "flex",
                flexDirection: "column",
                gap: 2
            }}
            role="dialog"
            aria-modal="false"
        >
            <button
                type="button"
                onClick={async () => {
                    onClose?.();
                    await supabase.auth.signOut();
                    router.push("/");
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#333333")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "rgba(42, 42, 42, 0.5)")}
                style={{
                    bg: "transparent",
                    color: "#fff",
                    display: "flex",
                    border: "none",
                    borderRadius: "8px",
                    outline: "none",
                    alignItems: "center",
                    padding: "5px",
                    gap: 10
                }}
            >
                <FiUser color="#aaa" size={18}/>
                Profile Settings
            </button>
            <button
                type="button"
                onClick={async () => {
                    onClose?.();
                    await supabase.auth.signOut();
                    router.push("/");
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#333333")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "rgba(42, 42, 42, 0.5)")}
                style={{
                    bg: "transparent",
                    color: "#fff",
                    display: "flex",
                    border: "none",
                    borderRadius: "8px",
                    outline: "none",
                    alignItems: "center",
                    padding: "5px",
                    gap: 10
                }}
            >
                <FiSettings color="#aaa" size={18}/>
                Preferences
            </button>
            <div role="separator" aria-orientation="horizontal" data-slot="dropdown-menu-separator" className="my-1 h-px bg-[#3a3a3a] w-full"></div>
            <button
                type="button"
                onClick={async () => {
                    onClose?.();
                    await supabase.auth.signOut();
                    router.push("/login");
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(100, 28, 28, 0.5)",e.currentTarget.style.color="#fff")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "rgba(42, 42, 42, 0.5)",e.currentTarget.style.color="rgba(235, 68, 68, 1)")}
                style={{
                    bg: "transparent",
                    color: "rgba(235, 68, 68, 1)",
                    display: "flex",
                    border: "none",
                    borderRadius: "8px",
                    outline: "none",
                    alignItems: "center",
                    padding: "5px",
                    gap: 10
                }}
            >
                <FiLogOut color="#aaa" size={18} />
                Log Out
            </button>
        </div>

    );
}