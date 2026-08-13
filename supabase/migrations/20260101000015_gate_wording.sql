-- =============================================================================
-- 0015  The last five strings on the entry gate
-- =============================================================================
-- The gate's heading, introduction, and buttons were already editable. These
-- five were still baked into the component, which meant a shop that needed
-- different phrasing — a different language, a regulator's exact wording, or
-- simply a friendlier tone — had to change code to get it.
--
-- Nothing on the gate is hardcoded after this.

alter table settings
  add column gate_optional_label text not null default 'Optional',
  -- {n} is replaced with how many boxes are still unticked. A shop that would
  -- rather not show a count can just write a sentence without the placeholder.
  add column gate_remaining_label text not null default '{n} left to confirm',
  add column gate_done_label     text not null default 'All set.',
  add column gate_pending_label  text not null default 'Confirming',
  add column gate_link_label     text not null default 'Read more';

comment on column settings.gate_remaining_label is
  'Shown under the confirm button while boxes are unticked. {n} is replaced with the count.';
comment on column settings.gate_link_label is
  'Fallback text for an acknowledgement that has a URL but no link text of its own.';
