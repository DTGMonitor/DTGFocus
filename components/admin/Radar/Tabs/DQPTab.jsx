import { QualityTable } from '@/components/admin/Radar/Dqp/DqpTable';
import { ActionRequiredModal } from '@/components/admin/Radar/Dqp/ActionRequiredModal';
import FeedbackModal from '@/components/admin/Radar/Dqp/FeedbackModal';

/**
 * DQPTab
 *
 * Thin prop-forwarding shell around the existing QualityTable, ActionRequiredModal
 * and FeedbackModal. All DQP state and handlers remain in SensorDetail — this
 * component performs no logic of its own (design decision, see tasks.md notes).
 *
 * Props:
 *   dqpList            {Array}
 *   onUpdate           {function}  - handleStatusRequest from SensorDetail
 *   isDQPModalOpen     {boolean}
 *   pendingUpdate      {object|null}
 *   onDQPModalClose    {function}
 *   onDQPModalSubmit   {function}
 *   sharedRegions      {Array}
 *   isFeedbackModalOpen{boolean}
 *   feedbackModalData  {Array}
 *   onFeedbackSubmit   {function}
 *   onFeedbackCancel   {function}
 *   sensor             {object}
 *
 * Requirements: 8.1, 8.2, 8.3
 */
export default function DQPTab({
  dqpList,
  onUpdate,
  isDQPModalOpen,
  pendingUpdate,
  onDQPModalClose,
  onDQPModalSubmit,
  sharedRegions,
  isFeedbackModalOpen,
  feedbackModalData,
  onFeedbackSubmit,
  onFeedbackCancel,
  dqpModalDefaultSubject,
}) {
  return (
    <div className="flex flex-col w-full gap-2 p-4 text-[var(--dtg-text-primary)]">
      <h2 className="text-xl font-medium border-b border-[var(--dtg-border-medium)] mb-4 pb-2">
        Data Quality
      </h2>

      <QualityTable data={dqpList} onUpdate={onUpdate} />

      <ActionRequiredModal
        isOpen={isDQPModalOpen}
        onClose={onDQPModalClose}
        onSubmit={onDQPModalSubmit}
        item={pendingUpdate?.item}
        targetStatus={pendingUpdate?.newValue}
        alarmRegions={sharedRegions}
        defaultSubject={dqpModalDefaultSubject}
      />

      <FeedbackModal
        isOpen={isFeedbackModalOpen}
        onClose={onFeedbackCancel}
        data={feedbackModalData}
        onSubmit={onFeedbackSubmit}
        regions={sharedRegions}
      />
    </div>
  );
}
