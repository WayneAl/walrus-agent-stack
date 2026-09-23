#[test_only]
module channel_log::channel_log_tests;

use channel_log::channel_log::{Self, Registry, ChannelLog};
use std::string;
use std::unit_test::{assert_eq, destroy};
use sui::clock;
use sui::test_scenario as ts;
use sui::vec_set;
use sui_groups::permissioned_group::PermissionedGroup;
use sui_stack_messaging::group_manager::GroupManager;
use sui_stack_messaging::messaging::{Self, Messaging, MessagingNamespace};
use sui_stack_messaging::version::{Self, Version};

const ALICE: address = @0xA11CE;
const BOB: address = @0xB0B;

fun setup(ts: &mut ts::Scenario) {
    ts.next_tx(ALICE);
    messaging::init_for_testing(ts.ctx());
    version::init_for_testing(ts.ctx());
    channel_log::init_for_testing(ts.ctx());
}

/// Alice creates a group; BOB joins as reader only (no MessagingSender).
fun new_group(ts: &mut ts::Scenario, uuid: vector<u8>): PermissionedGroup<Messaging> {
    ts.next_tx(ALICE);
    let version = ts.take_shared<Version>();
    let mut namespace = ts.take_shared<MessagingNamespace>();
    let group_manager = ts.take_shared<GroupManager>();
    let mut members = vec_set::empty();
    members.insert(BOB);
    let (group, history) = messaging::create_group(
        &version,
        &mut namespace,
        &group_manager,
        string::utf8(b"g"),
        string::utf8(uuid),
        b"dek",
        members,
        ts.ctx(),
    );
    ts::return_shared(version);
    ts::return_shared(namespace);
    ts::return_shared(group_manager);
    destroy(history);
    group
}

#[test]
fun sender_posts_in_order_at_derived_address() {
    let mut ts = ts::begin(ALICE);
    setup(&mut ts);
    let group = new_group(&mut ts, b"u1");
    let clock = clock::create_for_testing(ts.ctx());

    ts.next_tx(ALICE);
    let mut registry = ts.take_shared<Registry>();
    let mut log = channel_log::new_log(&mut registry, &group, ts.ctx());
    assert_eq!(object::id(&log).to_address(), channel_log::log_address(&registry, object::id(&group)));
    channel_log::post(&mut log, &group, string::utf8(b"blob-0"), &clock, ts.ctx());
    channel_log::post(&mut log, &group, string::utf8(b"blob-1"), &clock, ts.ctx());
    assert_eq!(log.length(), 2);
    let e = log.entry(1);
    assert_eq!(e.entry_blob_id(), string::utf8(b"blob-1"));
    assert_eq!(e.entry_sender(), ALICE);
    channel_log::share_log(log);
    ts::return_shared(registry);

    destroy(group);
    clock.destroy_for_testing();
    ts.end();
}

#[test, expected_failure(abort_code = channel_log::ENotSender)]
fun reader_cannot_post() {
    let mut ts = ts::begin(ALICE);
    setup(&mut ts);
    let group = new_group(&mut ts, b"u1");
    let clock = clock::create_for_testing(ts.ctx());

    ts.next_tx(ALICE);
    let mut registry = ts.take_shared<Registry>();
    let log = channel_log::new_log(&mut registry, &group, ts.ctx());
    channel_log::share_log(log);
    ts::return_shared(registry);

    ts.next_tx(BOB);
    let mut log = ts.take_shared<ChannelLog>();
    channel_log::post(&mut log, &group, string::utf8(b"blob"), &clock, ts.ctx());
    abort
}

#[test, expected_failure(abort_code = channel_log::ENotSender)]
fun reader_cannot_create_log() {
    let mut ts = ts::begin(ALICE);
    setup(&mut ts);
    let group = new_group(&mut ts, b"u1");

    ts.next_tx(BOB);
    let mut registry = ts.take_shared<Registry>();
    let _log = channel_log::new_log(&mut registry, &group, ts.ctx());
    abort
}

#[test, expected_failure]
fun second_log_for_same_group_aborts() {
    let mut ts = ts::begin(ALICE);
    setup(&mut ts);
    let group = new_group(&mut ts, b"u1");

    ts.next_tx(ALICE);
    let mut registry = ts.take_shared<Registry>();
    let log = channel_log::new_log(&mut registry, &group, ts.ctx());
    channel_log::share_log(log);
    let _again = channel_log::new_log(&mut registry, &group, ts.ctx());
    abort
}

#[test, expected_failure(abort_code = channel_log::EWrongGroup)]
fun post_to_other_groups_log_aborts() {
    let mut ts = ts::begin(ALICE);
    setup(&mut ts);
    let group1 = new_group(&mut ts, b"u1");
    let group2 = new_group(&mut ts, b"u2");
    let clock = clock::create_for_testing(ts.ctx());

    ts.next_tx(ALICE);
    let mut registry = ts.take_shared<Registry>();
    let mut log = channel_log::new_log(&mut registry, &group1, ts.ctx());
    channel_log::post(&mut log, &group2, string::utf8(b"blob"), &clock, ts.ctx());
    abort
}

#[test, expected_failure(abort_code = channel_log::EEmptyBlobId)]
fun empty_blob_id_aborts() {
    let mut ts = ts::begin(ALICE);
    setup(&mut ts);
    let group = new_group(&mut ts, b"u1");
    let clock = clock::create_for_testing(ts.ctx());

    ts.next_tx(ALICE);
    let mut registry = ts.take_shared<Registry>();
    let mut log = channel_log::new_log(&mut registry, &group, ts.ctx());
    channel_log::post(&mut log, &group, string::utf8(b""), &clock, ts.ctx());
    abort
}
