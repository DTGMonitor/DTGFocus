// utils/openOutlookDraft.ts
//
// Hand a pre-filled draft to whatever the operator has registered for mailto:
// (Outlook, on every DTG workstation). Nothing is sent — the draft opens and the
// analyst reviews it, which is why every flow that writes to the database does
// its writes FIRST and drafts afterwards.

export const openOutlookDraft = (
    subject: string,
    body: string,
    toGroup: string,
    ccGroup?: string
): void => {
    const mailtoLink =
        `mailto:${encodeURIComponent(toGroup)}` +
        `?subject=${encodeURIComponent(subject)}` +
        `&body=${encodeURIComponent(body)}` +
        (ccGroup ? `&cc=${encodeURIComponent(ccGroup)}` : '');

    window.location.href = mailtoLink;
};
