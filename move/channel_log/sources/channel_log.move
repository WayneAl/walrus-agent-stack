/// Serverless message index for sui-stack-messaging groups.
///
/// Each group gets one shared `ChannelLog`, derived from the `Registry` by the
/// group's ID so clients can compute its address. A post appends a Walrus blob
/// ID (the Seal-encrypted message envelope) and is accepted only when the
/// sender holds `MessagingSender` in the group, so authorization happens on
/// chain at post time. The entry index is the message `order`.
module channel_log::channel_log;

use std::string::String;
use sui::clock::Clock;
use sui::derived_object;
use sui::event;
use sui::table_vec::{Self, TableVec};
use sui_groups::permissioned_group::PermissionedGroup;
use sui_stack_messaging::messaging::{Messaging, MessagingSender};

const ENotSender: u64 = 0;
const EWrongGroup: u64 = 1;
const EEmptyBlobId: u64 = 2;

public struct Registry has key {
    id: UID,
}

public struct ChannelLog has key {
    id: UID,
    group_id: ID,
    entries: TableVec<Entry>,
}

public struct Entry has copy, drop, store {
    blob_id: String,
    sender: address,
    timestamp_ms: u64,
}

public struct Posted has copy, drop {
    group_id: ID,
    log_id: ID,
    order: u64,
    sender: address,
    blob_id: String,
}

fun init(ctx: &mut TxContext) {
    transfer::share_object(Registry { id: object::new(ctx) });
}

/// Create the log for `group`. Aborts if it already exists (derived UID is
/// claimed once), so a racing second creator retries with a plain `post`.
public fun new_log(
    registry: &mut Registry,
    group: &PermissionedGroup<Messaging>,
    ctx: &mut TxContext,
): ChannelLog {
    assert!(group.has_permission<Messaging, MessagingSender>(ctx.sender()), ENotSender);
    let group_id = object::id(group);
    ChannelLog {
        id: derived_object::claim(&mut registry.id, group_id),
        group_id,
        entries: table_vec::empty(ctx),
    }
}

public fun share_log(log: ChannelLog) {
    transfer::share_object(log);
}

public fun post(
    log: &mut ChannelLog,
    group: &PermissionedGroup<Messaging>,
    blob_id: String,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert!(object::id(group) == log.group_id, EWrongGroup);
    assert!(blob_id.length() > 0, EEmptyBlobId);
    let sender = ctx.sender();
    assert!(group.has_permission<Messaging, MessagingSender>(sender), ENotSender);
    let order = log.entries.length();
    log.entries.push_back(Entry { blob_id, sender, timestamp_ms: clock.timestamp_ms() });
    event::emit(Posted { group_id: log.group_id, log_id: object::id(log), order, sender, blob_id });
}

public fun log_address(registry: &Registry, group_id: ID): address {
    derived_object::derive_address(object::id(registry), group_id)
}

public fun length(log: &ChannelLog): u64 { log.entries.length() }

public fun group_id(log: &ChannelLog): ID { log.group_id }

public fun entry(log: &ChannelLog, order: u64): Entry { *log.entries.borrow(order) }

public fun entry_blob_id(e: &Entry): String { e.blob_id }

public fun entry_sender(e: &Entry): address { e.sender }

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }
