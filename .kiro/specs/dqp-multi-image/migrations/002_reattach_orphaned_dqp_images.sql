-- 002_reattach_orphaned_dqp_images.sql
--
-- Data repair, not schema. Run AFTER 001.
--
-- Every client_images row with category = 'dqp' that no dqp_values row points at
-- is an image the old single-id uploader dropped on the floor: the file reached
-- Storage and the row reached client_images, but `dqp_values.image` was
-- overwritten by the next file in the same upload.
--
-- Section A only REPORTS them — run it first and read the output. Section B
-- repairs the one row you reported (dqp_values.id = 55638, which should carry
-- images 250 and 251, not 251 alone). Adapt or repeat it per row from A's list;
-- it is deliberately not a blanket UPDATE, because matching an orphan back to a
-- parameter is a judgement call, not something subcategory can be trusted for.

-- A. Report the orphans ------------------------------------------------------

select ci.id,
       ci.date,
       ci.subcategory   as parameter_name,
       ci.image_url,
       ci.uploadedby
  from public.client_images ci
 where ci.category = 'dqp'
   and not exists (
     select 1 from public.dqp_values v where ci.id = any (v.image_ids)
   )
 order by ci.date desc, ci.id desc;

-- B. Reattach image 250 to dqp_values 55638, ahead of 251 -------------------
-- Upload order, so the figure numbering in the report reads 250 then 251.
-- 251 keeps the row's existing caption; 250 gets an empty one, which the report
-- renders as the parameter name until someone fills it in from the DQP table.

update public.dqp_values
   set image_ids      = array[250, 251]::bigint[],
       image_captions = array['', coalesce(caption, 'Alarm mask recommendations')]
 where id = 55638
   and image_ids = array[251]::bigint[];   -- no-op if already repaired

-- Verify
select id, parameter_id, image_ids, image_captions
  from public.dqp_values
 where id = 55638;
