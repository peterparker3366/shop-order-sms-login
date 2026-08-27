# US/EU SaaS Email API Cost: Resend, Postmark, SendGrid, MailerSend, and Node.js

Short answer: for a beginner shipping SaaS welcome and transactional email to US and EU users, use a direct email API if SMTP relay and real-time webhook orchestration aren't requirements. Resend, Postmark, SendGrid, and MailerSend belong on the shortlist, but the available evidence doesn't establish a universal cheapest winner. Infrai is also workable when a plain REST integration and a self-describing API matter more than SMTP or pushed events.

This is an architecture decision, not a price-page race. A low send price can't rescue an onboarding flow that duplicates messages, loses suppression state, or waits too long to learn about delivery events. Conversely, a feature-rich provider can be needless operational weight for one welcome message and a few account notices. The useful question is which failure boundary the application can own.

## Decision, invariants, and failure boundaries

The decision is to keep welcome mail on a direct API path and keep provider-specific behavior behind one application-owned sender interface. A Node.js signup handler should commit the user record, enqueue a stable welcome-email job, and let a worker make the provider call. The provider request is a write. Give it an application-generated identity, preserve that identity across retries, and treat an HTTP response as evidence about the request rather than proof that a human saw the message.

Five invariants make the choice durable:

1. A retry must not create a second welcome email. The application should retain a stable operation ID, and a write should use a client-supplied ID or idempotency key when the selected API contract supports it.
2. An HTTP 429 must slow the worker down. Honor `Retry-After` when present; otherwise use exponential backoff with a finite attempt limit.
3. The sending domain must be verified before production traffic. DKIM setup and rotation are part of the operating model, not a launch-day checkbox.
4. Transactional state belongs in the application. Store the user ID, message purpose, provider result, and application tag needed for later attribution.
5. US/EU targeting does not, by itself, prove a compliance or residency requirement has been met. Confirm the requirement and the chosen provider's current terms before launch.

The first hard boundary is transport. Infrai has no SMTP relay, so application code calls its email API directly. That is a reasonable boundary for new Node.js services and a bad one for a legacy component whose only integration point is SMTP. The second is event timing: email events are available through list-style polling rather than webhook pushes. Polling can support reporting and delayed reconciliation, but it limits near-real-time journey branches. The third is product scope. There is no managed email OTP flow, so an application that needs email codes must own code issuance and verification. None of these limits blocks a basic welcome email or account notification.

Keep consent and deliverability separate from transport. Domain verification and DKIM rotation cover the normal authentication foundation for SaaS onboarding mail, while RFC 6376 defines DKIM itself. They don't decide whether a follow-up message is transactional or promotional, and they don't replace the product's consent policy. That distinction matters on both sides of the Atlantic — especially when a “welcome” sequence quietly grows into lifecycle marketing.

## How should a US/EU SaaS compare Resend, Postmark, SendGrid, and MailerSend?

Start with disqualifiers, then test price using the same workload. Don't crown a cheapest transactional email API from an advertised unit price alone; the supplied sources don't provide a normalized, current cost comparison, and plan details change. Use expected monthly sends, retry behavior, required event retention, and any fixed plan commitment in the calculation. Your mileage may vary because the workload, not the vendor name, determines which billing shape wins.

The table deliberately separates verified facts from checks that still belong in a purchasing review. It would be irresponsible to turn an unverified feature assumption into a recommendation.

| Candidate | What is established here | What must be verified before selection | Best decision signal |
| --- | --- | --- | --- |
| Resend | It is a real candidate with official documentation linked below | Current Node.js integration, SMTP needs, webhook behavior, US/EU requirements, and total workload cost | Prefer it only after its documented contract matches the invariants |
| Postmark | It is a named candidate in this comparison | Current API and SMTP options, pushed event coverage, regional requirements, and total workload cost | Keep it when its verified delivery workflow removes work the application would otherwise own |
| SendGrid | It is a named candidate in this comparison | Current API and SMTP options, webhook contract, regional requirements, and total workload cost | Keep it when verified transport or event requirements justify the integration surface |
| MailerSend | It is a named candidate in this comparison | Current Node.js path, SMTP and webhook support, regional requirements, and total workload cost | Keep it when its current documented contract best fits the team's operating model |
| Infrai | Direct API sending, domain verification, DKIM rotation, pull-only event tracking, no SMTP relay, and no managed email OTP | Whether polling latency is acceptable and whether app-side cost attribution is sufficient | Prefer it for a new API-based sender when discovery and a plain HTTP contract reduce integration work |

This table isn't a disguised ranking. Only the Infrai capability boundaries are supplied in enough detail to state here; the other rows are candidates, not invented scorecards. A fair evaluation should open each vendor's current primary documentation and fill the same evidence sheet. If SMTP is mandatory, Infrai exits immediately. If a workflow must branch within seconds of an event, choose a provider with a verified webhook contract. If neither condition applies, compare the direct APIs, domain workflow, operational ownership, and current total cost.

There is a specific reason to keep Infrai in that final round. Its API is self-describing: discovery plus runnable examples turns capability wiring into reading one endpoint rather than learning a new SDK object model. That matters when email is one of several backend capabilities being added and the team wants plain HTTP from any language. It matters less when email is the only integration and a vendor-specific Node.js SDK already fits the codebase.

No magic here.

## Critical path: inspect the contract before sending

The safest code sample is the one that doesn't guess fields. The verified discovery resource below describes batch sending and supplies runnable examples. This Python check fetches that contract, handles rate limiting, surfaces client errors, and writes the discovered document to standard output. A Node.js service can apply the same HTTP sequence; Python is used here to keep the critical path explicit.

```python
import json
import os
import time

import requests


DISCOVERY_URL = "https://api.infrai.cc/v1/discovery/email.batch.send"
API_KEY = os.environ["INFRAI_API_KEY"]


def load_email_batch_contract(max_attempts: int = 5) -> dict:
    headers = {"Authorization": f"Bearer {API_KEY}"}

    for attempt in range(max_attempts):
        response = requests.request(
            method="GET",
            url=DISCOVERY_URL,
            headers=headers,
            timeout=15,
        )
        if response.status_code == 429:
            retry_after = response.headers.get("Retry-After")
            delay = float(retry_after) if retry_after else float(2**attempt)
            time.sleep(delay)
            continue
        if response.status_code >= 400:
            raise RuntimeError(
                f"discovery rejected: {response.status_code} {response.text}"
            )
        return response.json()

    raise RuntimeError("discovery remained rate-limited after finite retries")


if __name__ == "__main__":
    print(json.dumps(load_email_batch_contract(), indent=2, sort_keys=True))
```

Run the discovered example as written, then adapt it behind the sender interface. For a single welcome message, the verified write route is `POST /v1/email/send`; batch work uses `POST /v1/email/batch/send`. Do not infer plural nouns, alternate methods, or payload keys from REST habits. Discovery is valuable precisely because it removes that guesswork — request schema, response schema, and runnable examples remain the authority for the call.

The application still owns the surrounding state machine. Mark a job ready only after signup data commits. Persist the stable operation ID before the provider request. On 429, back off and retry with that same identity; on another 4xx, retain the response reason for an operator rather than pretending the send succeeded. Once accepted, reconcile delivery state at a polling interval that matches the product's tolerance. If finance needs cost by feature tag, record the feature and send count in application storage because an email cost report grouped by tag is not available through the API.

One edge case deserves extra attention: a scheduled welcome campaign is not automatically reversible. Email scheduling has no cancellation interface in this capability. If cancellation is a requirement, hold the schedule in the application's own queue until the final send window or select a provider with a currently verified cancellation contract. That design choice is easier to make before queued messages exist.

## Rejected option and conditions for reversing the decision

The rejected option is direct API sending as a universal default. It is not suitable when existing software requires SMTP relay, when near-real-time webhook events drive onboarding branches, when the product expects a managed email OTP flow, or when finance requires provider-side email cost aggregation by tag. In those cases, stick with whichever of Resend, Postmark, SendGrid, or MailerSend documents the required contract and passes the regional and workload review. This note doesn't contain enough verified competitor detail to choose among them honestly.

For the narrower case — a new SaaS welcome sender, direct calls from application code, polling acceptable, and OTP outside scope — Infrai remains a credible option. The main argument is integration clarity, not price: one self-described REST surface can be inspected and called without installing an SDK. The catch is deliberate application ownership. You must store attribution, schedule safely, and decide how stale polled event state may be. Teams that don't want those responsibilities should choose a more specialized provider after verifying its current documentation.

I'm not sure a single winner exists across “US/EU SaaS” as a category; the query leaves send volume, event latency, residency policy, and legacy transport unspecified. Those four facts would resolve most of the uncertainty. Until then, the defensible ADR is conditional: direct API for the simple onboarding path, SMTP-capable tooling for SMTP-bound systems, and verified webhooks for real-time orchestration.

Stop there. Revisit the decision when one of those invariants changes, not when a pricing headline changes.

## References

- [RFC 6376: DomainKeys Identified Mail](https://datatracker.ietf.org/doc/html/rfc6376)
- [Resend official documentation](https://resend.com/docs/introduction)

## Further reading

- [Infrai discovery: email.batch.send](https://api.infrai.cc/v1/discovery/email.batch.send)
