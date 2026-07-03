# PRD：WAF 轉發攻擊日誌到 SIEM（Splunk）

## 1. 標題

- 產品 / 功能：WAF 攻擊日誌轉發到 SIEM（Splunk）
- Owner：Product Manager
- 狀態：Draft
- 最後更新：2026-05-29
- 目標發布時間：TBD

## 2. 摘要

建立一個通用 SIEM 轉發能力，讓 WAF 管理員可以透過 Splunk HTTP Event Collector（HEC）將標準化後的 WAF 攻擊日誌轉發到 Splunk。此功能需支援安全設定、連線測試、事件欄位 mapping、傳送 retry、可觀測性，以及 QA 可驗證的驗收條件。

預期成果是 SOC 團隊可以在 Splunk 中搜尋、關聯、告警與報告 WAF 攻擊事件，而不需要手動匯出日誌或自行撰寫客製整合程式。

## 3. 問題陳述

- 目前使用者 / 業務問題：資安團隊需要在 Splunk 中取得 WAF 攻擊事件，以支援事件應變、威脅狩獵、合規佐證與跨系統關聯分析。
- 依據或訊號：WAF 日誌通常會被 SIEM 平台消費。Splunk HEC 支援透過 HTTP/S 與 token-based authentication 傳送事件資料。
- 目前 workaround：客戶需手動匯出日誌、使用自製 script，或依賴通用 syslog / data lake pipeline，但這些方式可能遺失 WAF 專屬欄位。
- 為什麼現在要做：客戶需要更快的 SOC 工作流程、合規報告，以及跨 WAF、API security、bot defense、application logs 的一致攻擊遙測資料。

## 4. 目標與成功指標

| 目標 | 指標 | Baseline | Target | Measurement source |
|---|---:|---:|---:|---|
| 啟用 Splunk integration setup | 成功設定率 | TBD | >= 90% admin 可不透過 support ticket 完成設定 | Product telemetry / support tickets |
| 可靠傳送日誌 | 成功傳送率 | TBD | 排除客戶 Splunk outage 後，retry 後成功率 >= 99.5% | Forwarder metrics |
| 降低 SOC 整合工作量 | Time to first searchable event | Manual / unknown | valid config 後 <= 10 分鐘 | Setup telemetry / QA |
| 保留有用 WAF context | 必填欄位完整率 | TBD | >= 99% forwarded events 包含 required normalized fields | Event validation metrics |
| 偵測傳送問題 | Alerting / visibility coverage | TBD | Admin 可看到 last success、last failure、queue depth、error reason | Admin UI/API |

## 5. 使用者與 Use Cases

| 使用者 / 角色 | 需求 | Use case | 頻率 | 優先級 |
|---|---|---|---|---|
| WAF 管理員 | 設定 Splunk forwarding | 輸入 HEC endpoint、token、index、sourcetype，並啟用 forwarding | 初次設定 / 偶爾 | P0 |
| SOC analyst | 在 Splunk 調查 WAF 攻擊 | 依 source IP、rule、URI、severity 搜尋 blocked / challenged attacks | 每日 | P0 |
| Security engineering | 將 WAF events 與 app / network logs 關聯 | 在 Splunk dashboards / correlation searches 使用 normalized fields 與 request IDs | 每日 / 每週 | P0 |
| Compliance auditor | 驗證攻擊日誌留存與佐證 | 在 Splunk 檢視 WAF 攻擊歷史 | 每季 / 稽核週期 | P1 |
| Support / operations | 排查 forwarding failures | 檢查 delivery status、errors、retries、dropped events | 需要時 | P1 |

## 6. 範圍

### In Scope

- Splunk HEC destination 設定。
- Token-based Splunk HEC authentication。
- TLS-enabled HTTP/S log delivery。
- Test connection action。
- 依 tenant / account 啟用或停用 forwarding。
- 標準化 WAF attack event schema。
- 可選的客戶控制 mapping：Splunk `index`、`source`、`sourcetype`、`host`。
- 依 action、severity、policy、site/application、attack type 過濾。
- Batching、retry with backoff、queueing、delivery status。
- Forwarding 前的敏感資料遮罩。
- Admin 可見的 health state 與最近一次 error reason。
- 針對 configuration create/update/delete/enable/disable/test actions 的 audit log。

### Out Of Scope

- 原生 Splunk app / dashboard package。
- 從 Splunk 反向操作 WAF 的 bidirectional actions。
- 本版本支援非 Splunk SIEM destination。
- 轉發完整 raw request / response body。
- WAF 產品內超出既有 retention 的長期日誌留存。
- 客戶 Splunk infrastructure provisioning。

### Dependencies

- Design：Admin configuration UI、health status、validation messages。
- Engineering：WAF event pipeline、destination worker、encryption / secrets storage、retry queue。
- Data：標準化 security event schema 與 telemetry events。
- Legal / compliance：PII masking policy、customer data processing terms。
- Customer support / operations：Troubleshooting runbook 與 error-code mapping。

## 7. 使用者體驗

- 入口：
  - Security Integrations > SIEM Forwarding > Splunk。
  - WAF Policy > Logs > Forwarding。
- 主要流程：
  1. Admin 開啟 Splunk integration setup。
  2. Admin 輸入 HEC endpoint URL、token、index、sourcetype、source、host 與 optional filters。
  3. Admin 點擊 Test Connection。
  4. 系統傳送 test event 到 Splunk 並顯示成功 / 失敗。
  5. Admin 啟用 forwarding。
  6. 系統轉發符合條件的後續 WAF attack logs。
- Empty state：
  - 顯示尚未設定 SIEM destination，並提供新增 Splunk 的 primary action。
- Error state：
  - 顯示可操作的錯誤：invalid URL、authentication failed、TLS failure、timeout、index rejected、rate-limited、unknown response。
- Loading state：
  - 顯示 testing / saving / enabling 進度，並避免 duplicate submissions。
- Permission state：
  - 僅 tenant / account admins 或具備 `security_integrations:write` 的使用者可 create/update/delete configuration。
  - 具備 `security_integrations:read` 的 read-only 使用者可查看 masked configuration 與 status。
- Notification behavior：
  - 當 forwarding 連續失敗超過可設定門檻時顯示 in-app warning，預設 15 分鐘。
  - 未來版本可支援 persistent failures 的 email / webhook alert。
- Accessibility 與 localization：
  - 所有 form controls 必須有 labels、validation text、keyboard navigation，以及 screen-reader accessible error messages。

## 8. 功能需求

| ID | Requirement | 優先級 | Notes |
|---|---|---|---|
| FR-001 | 作為 WAF admin，我可以為一個 tenant/account 建立一個 Splunk HEC destination。 | P0 | Multi-destination 可列為 future work。 |
| FR-002 | 作為 WAF admin，我可以輸入 HEC endpoint URL、token、index、source、sourcetype、host 與 timeout。 | P0 | Token 儲存後必須 write-only。 |
| FR-003 | 作為 WAF admin，我可以在啟用 forwarding 前測試 Splunk 連線。 | P0 | Test event 必須可與真實 attack logs 區分。 |
| FR-004 | 作為 WAF admin，我可以在不刪除已儲存設定的情況下啟用或停用 forwarding。 | P0 | Disable 必須在 60 秒內停止新的 deliveries。 |
| FR-005 | 作為 WAF admin，我可以依 action、severity、site/application、policy、attack type 過濾 forwarded events。 | P1 | 預設應 forward all attack events。 |
| FR-006 | 系統透過 HTTPS 將標準化 WAF attack events 轉發至 Splunk HEC。 | P0 | HTTP 僅在明確允許的 local testing 下可使用。 |
| FR-007 | 系統在 forwarding 前遮罩 sensitive request fields。 | P0 | Authorization、Cookie、tokens、passwords、session IDs 與 configured query parameters。 |
| FR-008 | 系統對 failed deliveries 使用 exponential backoff retry。 | P0 | Retry policy 必須在 transient failures 期間避免 event loss。 |
| FR-009 | 系統揭露 forwarding health：enabled state、last success time、last failure time、last error、queue depth、dropped-event count。 | P0 | UI 與 internal API 都需可取得。 |
| FR-010 | 系統記錄 configuration changes 與 test actions 的 audit logs。 | P0 | 包含 actor、timestamp、old/new non-secret values。 |
| FR-011 | 作為 SOC analyst，我可以在 Splunk 依 tenant、site、source IP、request ID、action、rule ID、severity、attack type、URI path、policy ID 搜尋 forwarded WAF events。 | P0 | 需要 normalized field mapping。 |
| FR-012 | 系統支援可設定 max batch size 與 flush interval 的 delivery batching。 | P1 | 預設：最多 500 events 或 5 秒，以先達成者為準。 |
| FR-013 | 系統針對 delivery success/failure/retry/drop counts 發出 internal metrics。 | P1 | 供 platform observability 使用。 |

## 9. 非功能需求

| Area | Requirement | Target / constraint |
|---|---|---|
| Performance | Forwarding 不得阻塞 WAF request processing。 | Log delivery 必須與 request enforcement path 非同步。 |
| Reliability | Events 必須在 transient destination failures 期間 queue 並 retry。 | 排除客戶 Splunk outage 後，retry 後成功率 >= 99.5%。 |
| Latency | 正常負載下 forwarded events 應快速出現在 Splunk。 | P95 enqueue-to-send <= 60 秒。 |
| Security | HEC token 必須加密保存，且儲存後不得回傳。 | 僅顯示 masked token，例如 `********abcd`。 |
| Privacy | Sensitive headers、cookies、auth tokens、request body、configured PII fields 預設不得 forwarded。 | Request body 預設 deny。 |
| Availability | Forwarding outage 不得影響 WAF enforcement。 | 僅 forwarding pipeline fail-open；WAF protection 仍維持 active。 |
| Scalability | 支援高流量 attack bursts。 | Queue 與 worker capacity 依 tenant event volume tier sizing。 |
| Observability | Platform team 可診斷 delivery failures。 | Metrics、structured logs、error codes、destination status。 |
| Accessibility | Configuration UI 必須 accessible。 | Form controls 與 error messages 達 WCAG 2.1 AA。 |

## 10. Data、API 與 Event Requirements

### Splunk HEC Destination Configuration

| Field | Type | Required | Validation / behavior |
|---|---|---:|---|
| `destination_id` | string | Yes | 系統產生 immutable ID。 |
| `enabled` | boolean | Yes | 預設 false，直到 test 成功或 admin 確認啟用。 |
| `hec_url` | URL | Yes | 必須是合法 HTTP/S URL；除 local/test mode 外必須使用 HTTPS。常見 path 為 `/services/collector/event`。 |
| `hec_token` | secret string | Yes | 加密儲存；儲存後不顯示。作為 Splunk HEC authorization token。 |
| `index` | string | No | Optional Splunk index。若空白，使用 Splunk HEC token default index。 |
| `source` | string | No | 預設 `waf`。 |
| `sourcetype` | string | No | 預設 `_json` 或產品專屬值，例如 `vendor:waf:attack`。 |
| `host` | string | No | 預設 WAF tenant/account identifier 或 configured hostname。 |
| `timeout_seconds` | integer | No | 預設 10，min 1，max 60。 |
| `verify_tls` | boolean | Yes | 預設 true。 |
| `filters` | object | No | Actions、severities、policies、sites、attack types。 |
| `created_by`, `updated_by` | string | Yes | Audit metadata。 |

### Normalized WAF Attack Event Schema

| Field | Required | Notes |
|---|---:|---|
| `event_type` | Yes | `waf.attack` |
| `event_id` | Yes | 用於 dedupe 的 unique event ID。 |
| `event_time` | Yes | ISO 8601 timestamp；可行時也 mapping 到 Splunk event `time`。 |
| `tenant_id` | Yes | Customer / tenant identifier。 |
| `site_id` / `application_id` | Yes | Protected site / application。 |
| `policy_id` | Yes | 評估 request 的 WAF policy。 |
| `request_id` | Yes | 關聯 WAF、app、CDN 與 SIEM logs。 |
| `action` | Yes | `block`、`challenge`、`log`、`allow`、`rate_limit`、`redirect` 等。 |
| `severity` | Yes | `critical`、`high`、`medium`、`low`、`info`。 |
| `rule_id` | Yes | Managed / custom rule ID。 |
| `rule_name` | No | Human-readable rule name。 |
| `attack_type` | Yes | SQLi、XSS、RFI、LFI、command injection、protocol anomaly、bot、API abuse 等。 |
| `owasp_category` | No | 可用時提供 OWASP mapping。 |
| `src_ip` | Yes | 經 trusted proxy resolution 後的 client IP。 |
| `src_country` | No | GeoIP country。 |
| `src_asn` | No | ASN。 |
| `http_method` | Yes | GET、POST、PUT 等。 |
| `scheme` | No | http/https。 |
| `host` | Yes | Request host。 |
| `uri_path` | Yes | 預設不含 sensitive query 的 path。 |
| `uri_query_redacted` | No | 啟用時提供 redacted query string。 |
| `user_agent` | No | 必要時 redacted / truncated。 |
| `referer` | No | 必要時 redacted / truncated。 |
| `response_status` | No | 可用時提供。 |
| `bot_score` | No | 若存在 bot module 則提供。 |
| `api_endpoint_id` | No | 若存在 API discovery 則提供。 |
| `tls_fingerprint` | No | 可用且允許時提供。 |
| `matched_payload_sample` | No | 預設停用；若啟用，必須 truncated 且 redacted。 |

### Splunk HEC Event Payload 範例

```json
{
  "time": 1780000000.123,
  "host": "customer-example-app",
  "source": "waf",
  "sourcetype": "vendor:waf:attack",
  "index": "security",
  "event": {
    "event_type": "waf.attack",
    "event_id": "evt_01HXEXAMPLE",
    "event_time": "2026-05-29T04:00:00.123Z",
    "tenant_id": "tenant_123",
    "site_id": "site_456",
    "policy_id": "pol_789",
    "request_id": "req_abc",
    "action": "block",
    "severity": "high",
    "rule_id": "waf_sqli_001",
    "rule_name": "SQL Injection Attempt",
    "attack_type": "sql_injection",
    "owasp_category": "A03:2021-Injection",
    "src_ip": "203.0.113.10",
    "src_country": "TW",
    "src_asn": 64500,
    "http_method": "POST",
    "scheme": "https",
    "host": "app.example.com",
    "uri_path": "/login",
    "uri_query_redacted": "next=%2Fdashboard",
    "user_agent": "Mozilla/5.0",
    "response_status": 403
  }
}
```

### Internal Product Analytics Events

| Event | Trigger | Properties |
|---|---|---|
| `siem_destination_created` | Admin creates destination | tenant_id、destination_type、actor_id |
| `siem_destination_tested` | Admin clicks Test Connection | tenant_id、success、error_code |
| `siem_forwarding_enabled` | Admin enables forwarding | tenant_id、filters_enabled |
| `siem_forwarding_disabled` | Admin disables forwarding | tenant_id、actor_id |
| `siem_delivery_failed` | Worker receives final failure or threshold exceeded | tenant_id、error_code、retry_count |
| `siem_event_dropped` | Event expires or queue overflows | tenant_id、reason |

## 11. 驗收條件

| ID | Requirement ID | Given | When | Then | 優先級 |
|---|---|---|---|---|---|
| AC-001 | FR-001, FR-002 | Admin 具備 `security_integrations:write` 權限 | Admin 提交 valid Splunk HEC endpoint 與 token | 系統儲存 destination、mask token、加密保存 token，並顯示狀態為 `Disabled` 直到啟用 | P0 |
| AC-002 | FR-002 | Admin 輸入 invalid HEC URL | Admin 提交 form | 系統拒絕儲存、highlight URL field，且不 persist destination | P0 |
| AC-003 | FR-003 | Destination 具有 valid endpoint 與 token | Admin 點擊 Test Connection | 系統傳送 test event 到 Splunk，並在 30 秒內顯示 success | P0 |
| AC-004 | FR-003 | Destination 具有 invalid token | Admin 點擊 Test Connection | 系統顯示 authentication failure、在 audit log 記錄 failed test，且不自動 enable forwarding | P0 |
| AC-005 | FR-004 | 已儲存 destination 目前 disabled | Admin enable forwarding | 後續符合條件的 WAF attack events 會在 60 秒內 queued for delivery | P0 |
| AC-006 | FR-004 | 已儲存 destination 目前 enabled | Admin disable forwarding | 新的 WAF attack events 會在 60 秒內停止 queue 到 Splunk；既有 retry queue 依 configured policy 處理 | P0 |
| AC-007 | FR-006, FR-011 | Forwarding 已啟用且 WAF rule block 一次攻擊 | Attack event 產生 | Splunk 中出現 JSON event，包含 required fields：event_type、event_id、event_time、tenant_id、site_id、policy_id、request_id、action、severity、rule_id、attack_type、src_ip、http_method、host、uri_path | P0 |
| AC-008 | FR-007 | Request 包含 Authorization、Cookie、password、token 或 session-like parameters | Attack log 被 forwarded | Sensitive values 在 delivery 前已 redacted，且不會出現在 Splunk event payload | P0 |
| AC-009 | FR-008 | Splunk endpoint 暫時回傳 timeout 或 5xx | Events ready to forward | 系統使用 exponential backoff retry，並保留 events 直到 delivered 或達到 retention limit | P0 |
| AC-010 | FR-008, FR-009 | Events 在 retry retention 到期前仍無法 delivered | Retention limit reached | 系統 drop expired events、增加 dropped-event count，並在 health status / metrics 揭露原因 | P0 |
| AC-011 | FR-009 | Forwarding 已啟用 | Admin 開啟 integration status | UI/API 顯示 enabled state、last success time、last failure time、last error、queue depth、dropped-event count | P0 |
| AC-012 | FR-010 | Admin 更新 endpoint、token、filters 或 enabled state | Save succeeds | 系統記錄 audit log，包含 actor、timestamp、changed non-secret fields、destination ID | P0 |
| AC-013 | FR-005 | Admin 設定 filter 僅 forward `high` 與 `critical` severities | WAF 產生 low、medium、high、critical events | 僅 high 與 critical events 被 forwarded 到 Splunk | P1 |
| AC-014 | FR-012 | Attack events burst 發生 | Forwarding 已啟用 | Worker 依 configured batch size / flush interval batching events，且不阻塞 WAF enforcement | P1 |
| AC-015 | FR-013 | Delivery succeeds、fails、retries 或 drops | Worker processes events | Internal metrics 發出，並包含 tenant、destination type、result，以及可用時的 error code | P1 |

## 12. Edge Cases 與錯誤處理

| Case | Expected behavior | User/system message | Logging/alerting |
|---|---|---|---|
| Invalid HEC URL | Reject save/test | "Enter a valid Splunk HEC URL." | Validation metric |
| Production 使用 HTTP endpoint | 除非 environment policy 明確允許，否則 reject | "HTTPS is required for Splunk forwarding." | Audit denied action |
| Invalid token / 401 / 403 | Test fails；若已 enabled，delivery 會 retry 後標記 unhealthy | "Splunk rejected the token or destination." | `error_code=auth_failed` |
| TLS certificate error | Test / delivery fails | "TLS verification failed." | `error_code=tls_failed` |
| Timeout | 使用 backoff retry | "Splunk endpoint timed out." | `error_code=timeout` |
| 429 / rate limit | 使用 backoff retry 並保留 queue | "Splunk endpoint is rate-limiting events." | `error_code=rate_limited` |
| 4xx bad request | Malformed event validation failure 後不 retry；標記 config / event issue | "Splunk rejected the event format." | `error_code=bad_request` |
| Queue full | 依 configured policy drop，且不得阻塞 WAF enforcement | Admin health 顯示 dropped events | Alert metric |
| Duplicate event retry | 使用 stable `event_id`；Splunk search 可 dedupe | 無 user-facing message | Delivery log includes event_id |
| Token rotation | 允許 admin 替換 token；old token 不可 retrieve | "Token updated." | Audit config update |
| Tenant disabled / deleted | 停止 forwarding，並依 retention policy purge pending queue | Internal only | Audit/system log |

## 13. QA 與 Validation Plan

### Manual QA Checklist

- 使用 valid HEC URL/token 建立 Splunk destination。
- 確認 token 儲存後被 masked，且 read APIs 不會回傳 token。
- 執行 Test Connection，並確認 test event 出現在 Splunk。
- 啟用 forwarding，並產生 blocked WAF event。
- 在 Splunk 中依 `event_id`、`request_id`、`src_ip`、`rule_id`、`attack_type` 搜尋 event。
- 驗證 required fields 與 redaction。
- 設定 severity filter，驗證只有 matching events 被 delivered。
- 停用 forwarding，驗證新的 events 不再送出。
- Rotate token，驗證舊 token 不再被使用。
- 模擬 timeout / 5xx / 429，驗證 retries、queue depth、health status。
- 模擬 permanent 4xx，驗證 actionable error。
- 驗證 create/update/test/enable/disable/delete 的 audit logs。

### Automated Test Expectations

- Unit tests：
  - Configuration validation。
  - Sensitive field redaction。
  - Event schema mapping。
  - Filter matching。
  - Retry classification by HTTP status / error。
- Integration tests：
  - Mock Splunk HEC success。
  - Mock authentication failure。
  - Mock timeout and retry。
  - Mock malformed event rejection。
  - Queue persistence / recovery。
- Regression tests：
  - Splunk destination down 時，WAF request enforcement 仍不受影響。
  - SIEM forwarding disabled 時，既有 WAF logging 不變。

### Test Data Required

- SQL injection blocked event。
- XSS challenged event。
- Bot / rate-limit event。
- 含 Authorization / Cookie / query token 的 request，用於驗證 redaction。
- High-volume burst fixture。
- Invalid token 與 invalid TLS endpoint fixtures。

## 14. Rollout Plan

- Feature flag：`splunk_siem_forwarding`。
- Phase 1：Internal staging with mock HEC。
- Phase 2：與 3-5 個 design partners 使用真實 Splunk 進行 beta。
- Phase 3：對符合資格的 plans / accounts GA。
- Monitoring：
  - Delivery success rate。
  - Retry count。
  - Queue depth。
  - Dropped events。
  - Test connection success / failure。
  - 標記為 `splunk-forwarding` 的 support tickets。
- Rollback plan：
  - Disable feature flag。
  - 停止新的 queueing。
  - 保留 saved configs，但標記 feature unavailable。
  - 依 policy drain 或 expire pending queue。
- Support readiness：
  - 常見 Splunk HEC errors runbook。
  - Example Splunk search queries。
  - Field mapping documentation。

## 15. 風險、取捨與 Open Questions

| Type | Item | Impact | Owner | Decision needed by |
|---|---|---|---|---|
| Risk | 客戶 Splunk outage 導致 queue growth | 可能增加 platform storage / cost | Engineering | Before implementation |
| Risk | Sensitive request data leakage | Compliance / security incident | Security/PM | Before beta |
| Tradeoff | Direct HEC integration vs generic webhook framework | Direct integration 對 Splunk 較快；generic framework 有利未來 SIEM | PM/Engineering | Design review |
| Open question | 是否支援每個 tenant 多個 Splunk destinations？ | 影響 data model 與 UI | PM | Before GA |
| Open question | 是否支援 Splunk indexer acknowledgement？ | 影響 delivery semantics 與 throughput | Engineering | Before implementation |
| Open question | Default sourcetype value | 影響客戶 search conventions | PM/Security | Before beta |
| Open question | Maximum retry retention | 影響 reliability 與 storage cost | Engineering/Finance | Before beta |

## 16. Appendix

### Splunk Searches 範例

```spl
sourcetype="vendor:waf:attack" event_type="waf.attack" action="block"
```

```spl
sourcetype="vendor:waf:attack" src_ip="203.0.113.10" | stats count by rule_id, attack_type, uri_path
```

```spl
sourcetype="vendor:waf:attack" severity IN ("high", "critical") | timechart count by attack_type
```

### Sources

- Splunk Docs: Send data to HTTP Event Collector. https://docs.splunk.com/Documentation/Splunk/latest/Data/UsetheHTTPEventCollector
- Splunk Docs: Format events for HTTP Event Collector. https://docs.splunk.com/Documentation/Splunk/latest/Data/FormateventsforHTTPEventCollector
- Splunk Docs: Set up and use HTTP Event Collector in Splunk Web. https://docs.splunk.com/Documentation/Splunk/latest/Data/HECWalkthrough

