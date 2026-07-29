-- 001_dqp_image_arrays.sql
--
-- dqp_values carries ONE image per row (`image bigint -> client_images.id`) and
-- ONE caption. The uploader at SensorDetail.jsx loops over every selected file,
-- inserts a client_images row for each, then keeps only the last id — so a
-- multi-file upload silently orphaned every image but the final one.
--
-- This widens the row to N images with a caption each, as index-aligned arrays:
--
--     image_ids[i]  <->  image_captions[i]
--
-- Postgres cannot declare a foreign key over an array element, so referential
-- integrity is enforced by the trigger below rather than by an FK constraint.
-- The legacy `image` / `caption` columns are LEFT IN PLACE and still written by
-- nothing — they are read only as a fallback by utils/dqpImages.js, so a client
-- running pre-migration code cannot lose a figure mid-rollout. Drop them in a
-- later migration once every deployment is on the array path.

begin;

-- 1. The columns -------------------------------------------------------------

alter table public.dqp_values
  add column if not exists image_ids      bigint[] not null default '{}',
  add column if not exists image_captions text[]   not null default '{}';

comment on column public.dqp_values.image_ids is
  'client_images.id per attached figure, in display order. Index-aligned with image_captions.';
comment on column public.dqp_values.image_captions is
  'Figure caption per image_ids entry, same index. Empty string means "fall back to the parameter name".';

-- 2. Backfill from the single-image columns ----------------------------------
-- Only touches rows that have not already been migrated, so this is re-runnable.

update public.dqp_values
   set image_ids      = array[image]::bigint[],
       image_captions = array[coalesce(caption, '')]
 where image is not null
   and coalesce(array_length(image_ids, 1), 0) = 0;

-- 3. Keep the two arrays the same length -------------------------------------
-- Without this a caption can drift onto the wrong figure, which is worse than a
-- missing caption: the report would print a confident, incorrect one.

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'dqp_values_image_arrays_aligned'
       and conrelid = 'public.dqp_values'::regclass
  ) then
    alter table public.dqp_values
      add constraint dqp_values_image_arrays_aligned
      check (
        coalesce(array_length(image_ids, 1), 0)
        = coalesce(array_length(image_captions, 1), 0)
      );
  end if;
end $$;

-- 4. Referential integrity for the array elements ----------------------------
-- Stands in for the FK that `image` used to give us. Deliberately a constraint
-- trigger so it fires per statement-affected row and can be deferred inside a
-- transaction that inserts the images and the dqp_values update together.

create or replace function public.dqp_values_check_image_ids()
returns trigger
language plpgsql
as $$
declare
  missing bigint;
begin
  if coalesce(array_length(new.image_ids, 1), 0) = 0 then
    return new;
  end if;

  select id into missing
    from unnest(new.image_ids) as id
   where not exists (select 1 from public.client_images ci where ci.id = id)
   limit 1;

  if missing is not null then
    raise foreign_key_violation
      using message = format('dqp_values.image_ids references missing client_images.id %s', missing);
  end if;

  return new;
end $$;

drop trigger if exists dqp_values_image_ids_fk on public.dqp_values;
create constraint trigger dqp_values_image_ids_fk
  after insert or update of image_ids on public.dqp_values
  deferrable initially deferred
  for each row execute function public.dqp_values_check_image_ids();

-- Deleting a client_images row used to null the dqp_values.image FK; keep that
-- behaviour by stripping the id (and its caption) out of both arrays.
create or replace function public.client_images_detach_from_dqp()
returns trigger
language plpgsql
as $$
begin
  update public.dqp_values v
     set image_ids = sub.ids,
         image_captions = sub.caps
    from (
      select v2.id as row_id,
             coalesce(array_agg(t.img order by t.ord) filter (where t.img <> old.id), '{}') as ids,
             coalesce(array_agg(t.cap order by t.ord) filter (where t.img <> old.id), '{}') as caps
        from public.dqp_values v2
        cross join lateral unnest(v2.image_ids, v2.image_captions)
                     with ordinality as t(img, cap, ord)
       where old.id = any (v2.image_ids)
       group by v2.id
    ) sub
   where v.id = sub.row_id;

  return old;
end $$;

drop trigger if exists client_images_detach_from_dqp on public.client_images;
create trigger client_images_detach_from_dqp
  before delete on public.client_images
  for each row execute function public.client_images_detach_from_dqp();

-- 5. Lookup support ----------------------------------------------------------
-- `image_ids && array[$1]` / `$1 = any(image_ids)` for "which DQP rows use this
-- image?" — cheap to add now, expensive to notice missing later.

create index if not exists dqp_values_image_ids_idx
  on public.dqp_values using gin (image_ids);

commit;
