import { QualityTable } from '@/components/admin/Radar/Dqp/DqpTable';
import { ActionRequiredModal } from '@/components/admin/Radar/Dqp/ActionRequiredModal';
import FeedbackModal from '@/components/admin/Radar/Dqp/FeedbackModal';
import EditDqpEntryModal from '@/components/admin/Radar/Dqp/EditDqpEntryModal';

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
 *   onEdit             {function}  - open the edit modal for a row
 *   isEditModalOpen    {boolean}
 *   editingItem        {object|null}
 *   onEditModalClose   {function}
 *   onEditSubmit       {function}  - handleEditSubmit from SensorDetail
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
  onEdit,
  isEditModalOpen,
  editingItem,
  onEditModalClose,
  onEditSubmit,
  sensor,
}) {
  const exportSubtitle = [sensor?.radar_number, sensor?.site_name].filter(Boolean).join(' — ');

  return (
    <div className="flex flex-col w-full gap-2 p-4 text-[var(--dtg-text-primary)]">
      <h2 className="text-xl font-medium border-b border-[var(--dtg-border-medium)] mb-4 pb-2">
        Data Quality
      </h2>

      <QualityTable
        data={dqpList}
        onUpdate={onUpdate}
        onEdit={onEdit}
        exportTitle="Data Quality"
        exportSubtitle={exportSubtitle}
        radarNumber={sensor?.radar_number}
      />

      <ActionRequiredModal
        isOpen={isDQPModalOpen}
        onClose={onDQPModalClose}
        onSubmit={onDQPModalSubmit}
        item={pendingUpdate?.item}
        targetStatus={pendingUpdate?.newValue}
        alarmRegions={sharedRegions}
        defaultSubject={dqpModalDefaultSubject}
      />

      {/* `regions` scopes the open-recommendation list the edit modal shows for
          an alarm row — alarm_improvement reaches a wall folder only through
          alarm_record → alarm_region. */}
      <EditDqpEntryModal
        isOpen={isEditModalOpen}
        onClose={onEditModalClose}
        onSubmit={onEditSubmit}
        item={editingItem}
        regions={sharedRegions}
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
