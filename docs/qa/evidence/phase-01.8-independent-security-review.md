# Phase 01.8 — Independent Security Review Evidence

| Field | Result |
|---|---|
| Review type | Separate read-only security review agent; not the implementing session |
| Review session | `ses_e33556bb5ffevv6O34PmVZ5dQi` |
| Scope | Windows supervisor process Job Object and filesystem operations; TypeScript staging, runner, generation flow; tests and recorded finalize anomaly |
| Files edited by reviewer | None |
| Tests run by reviewer | None; implementation session ran tests separately and records results in Phase 01.8 report |
| Result | **NO SECURITY APPROVAL** — findings remain open; FE-01/FE-02 remain NO-GO |

The reviewer first identified that successful native finalize lacked a destination identity postcondition. Implementation added a retained-parent-relative target open and volume/file identity comparison against the opened source. On mismatch or inability to verify, helper returns `finalize_unconfirmed`; TypeScript maps this to `GEN_FINALIZE_UNCONFIRMED`, and generation preserves staging. A follow-up review judged this a **partial mitigation**, not resolution of the observed anomaly. It does not prove the opened source directory is the same object previously scaffolded and validated.

## Findings still open

1. **High, conditional — staging inherits parent ACL.** Native stage and marker creation do not supply a protected DACL. If the selected parent grants another principal inherited write/delete access, that principal may tamper with staging or replace project content. Review did not test cross-account behavior. Consider protected ACLs and test with a second standard-user account and permissive parent.
2. **Medium, conditional — cleanup marker race.** Cleanup enumerates and removes entries, deletes `.ownership.json`, then deletes the stage directory. A concurrent writer adding an entry after enumeration can make root deletion fail after ownership evidence is gone. Preserve recoverability and test the interleaving.
3. **Finalize source identity not anchored to validated output.** Current postcondition proves target matches the handle opened at finalize time, not necessarily the scaffold directory validated earlier. Prevent stage substitution or carry an identity/ownership proof across stages; test ordinary-directory replacement as well as junction replacement.
4. **NTSTATUS completion handling.** `rename_open_handle` treats nonnegative `NtSetInformationFile` status as success and does not inspect `IO_STATUS_BLOCK.Status`. Postcondition reduces false-success risk but should not replace correct completion-status handling or diagnostic capture.
5. **Lifecycle scripts are not sandboxed.** Job Objects constrain process lifetime, not filesystem, network, or credential access. Existing explicit-generation disclosure remains necessary; no sandbox claim is supported.
6. **Some filesystem reads/checks remain path-based.** In particular generated lockfile inspection and several scaffold/runner checks are not handle-rooted. Assess races under the documented threat model.

## Decision

This is independent review evidence from a separate agent, not human sign-off or release approval. Reviewer explicitly withheld approval. Resolve or formally accept remaining findings through the project's review process, investigate the original finalize anomaly, and obtain required human/CI acceptance before promoting any recipe or claiming readiness.
