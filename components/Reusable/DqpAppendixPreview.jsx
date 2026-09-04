"use client";

import { useEffect, useState } from "react";
import { X, Loader } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";

/**
 * The figures-and-appendix panel for one DQP row.
 *
 * Extracted from components/admin/Radar/Dqp/DqpTable.jsx so the client radar
 * detail can show a finding's appendix exactly as the admin sensor detail does
 * — same figure numbering, same caption fallback, same appendix paragraph
 * underneath. Two copies of this markup would have drifted the first time
 * either side was touched.
 *
 * `image_url` on a row is a storage path, not a URL; the figures are signed as
 * one batch so the panel opens in a single round trip rather than one per
 * figure.
 *
 * @param item             row-like: { images: [{id, caption, image_url}], appendix }
 * @param fallbackCaption  caption for a figure that carries none — normally the
 *                         parameter's name
 * @param bucket           storage bucket holding the figures
 */
export default function DqpAppendixPreview({ item, fallbackCaption = "", bucket = "Radar", onClose }) {
    const [images, setImages] = useState([]);
    const [loading, setLoading] = useState(false);
    const [signError, setSignError] = useState("");

    useEffect(() => {
        if (!item) return;
        let cancelled = false;
        const rowImages = item.images ?? [];

        const sign = async () => {
            setImages([]);
            setSignError("");
            if (!rowImages.length) return;
            setLoading(true);
            try {
                const signed = await Promise.all(
                    rowImages.map(async (img) => {
                        const { data, error } = await supabase.storage
                            .from(bucket)
                            .createSignedUrl(img.image_url, 3600);
                        if (error) throw error;
                        return { ...img, url: data.signedUrl };
                    })
                );
                if (!cancelled) setImages(signed);
            } catch (error) {
                console.error("Error loading image:", error);
                // The panel stays open on a failed sign rather than closing:
                // the appendix text is the half that does not depend on
                // storage, and losing it too tells the reader nothing.
                if (!cancelled) setSignError("Figures could not be loaded.");
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        sign();
        return () => {
            cancelled = true;
        };
    }, [item, bucket]);

    if (!item) return null;

    return (
        <div
            className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-5"
        >
            <div
                className="w-full max-w-4xl bg-[var(--dtg-bg-card)] rounded-lg overflow-hidden flex flex-col relative border border-[var(--dtg-border-medium)] max-h-[90vh]"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="px-5 py-3 border-b border-[var(--dtg-border-medium)] flex justify-between items-center flex-shrink-0">
                    <h3 className="m-0 text-[var(--dtg-text-primary)] text-base">
                        Image Preview
                        {images.length > 1 && (
                            <span className="ml-2 text-sm text-[var(--dtg-text-secondary)]">
                                ({images.length} figures)
                            </span>
                        )}
                    </h3>
                    <button
                        onClick={onClose}
                        className="bg-transparent border-none text-[var(--dtg-gray-400)] cursor-pointer p-1 flex items-center hover:text-[var(--dtg-text-primary)]"
                    >
                        <X size={20} />
                    </button>
                </div>
                <div className="p-5 overflow-y-auto">
                    {loading ? (
                        <div className="h-96 flex items-center justify-center text-[var(--dtg-text-primary)]">
                            <Loader className="animate-spin mr-2" /> Loading Image...
                        </div>
                    ) : signError ? (
                        <p className="text-sm text-[var(--dtg-gray-400)] italic">{signError}</p>
                    ) : (
                        // Stacked and scrollable rather than a carousel: the captions
                        // only make sense read against each other, and the report
                        // prints them in this same order.
                        <div className="space-y-6">
                            {images.map((img, i) => (
                                <div key={img.id ?? i}>
                                    <img
                                        src={img.url}
                                        alt={`DQP appendix figure ${i + 1}`}
                                        className="w-full h-auto max-h-[65vh] object-contain rounded"
                                    />
                                    <p className="text-center text-sm text-[var(--dtg-text-secondary)] mt-3 italic">
                                        <strong>Figure {i + 1}. </strong>
                                        {img.caption || fallbackCaption}
                                    </p>
                                </div>
                            ))}
                        </div>
                    )}

                    {item.appendix && (
                        <p className="text-justify text-sm text-[var(--dtg-text-secondary)] mt-2">{item.appendix}</p>
                    )}
                </div>
            </div>
        </div>
    );
}
