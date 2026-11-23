import assert from "node:assert/strict";
import test from "node:test";
import {normalizeEmployeeList, normalizeUlbList} from "../src/data/executiveLocations.js";

test("normalizes the ULB list using appid as the stable ID", () => {
    assert.deepEqual(normalizeUlbList([
        {ulb: "Amalner Nagar Parishad", appid: 3339, faq: "0"},
        {ulb: "Aarmori Nagar Parishad", appid: 3076, faq: "0"},
    ]), [
        {id: "3076", name: "Aarmori Nagar Parishad"},
        {id: "3339", name: "Amalner Nagar Parishad"},
    ]);
});

test("rejects malformed or duplicate ULB records", () => {
    assert.throws(() => normalizeUlbList([]), /non-empty JSON array/);
    assert.throws(() => normalizeUlbList([{ulb: "Amalner"}]), /appid and ulb/);
    assert.throws(() => normalizeUlbList([
        {ulb: "Amalner", appid: 3339},
        {ulb: "Another ULB", appid: 3339},
    ]), /duplicate appid/);
});

test("normalizes employee choices from the AllBeats employee list", () => {
    assert.deepEqual(normalizeEmployeeList({
        AllBeats: [
            {UserId: 7, UserName: "Assigned worker", IsUserActive: true, IsBeatActive: true},
            {UserId: "8", UserName: "Other worker", IsUserActive: false, IsBeatActive: true},
        ],
    }), [
        {id: "7", name: "Assigned worker", isInactive: false},
        {id: "8", name: "Other worker", isInactive: true},
    ]);
});

test("normalizes all employee choices returned by the AllUsers API", () => {
    assert.deepEqual(normalizeEmployeeList({
        AllUsers: [
            {UserId: 7, UserName: "Assigned worker"},
            {UserId: "8", UserName: "Other worker"},
            {UserId: 7, UserName: "Assigned worker"},
        ],
        InactiveUsers: [{UserId: 8, UserName: "Other worker"}],
    }), [
        {id: "7", name: "Assigned worker"},
        {id: "8", name: "Other worker", isInactive: true},
    ]);
});

test("rejects employee lists that lack the expected identity fields", () => {
    assert.throws(() => normalizeEmployeeList({}), /AllUsers or AllBeats array/);
    assert.throws(() => normalizeEmployeeList({
        AllBeats: [{UserId: 7}],
    }), /UserId and UserName/);
});
