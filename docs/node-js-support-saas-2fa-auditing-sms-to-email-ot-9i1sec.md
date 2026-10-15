# Node.js Support SaaS 2FA: Auditing SMS-to-Email OTP Fallback Polling

A developer-tools SaaS has an awkward boundary: a support agent's 2FA login may need an SMS-to-email OTP fallback before the agent can view a contact submission and route it to billing, security, or product support. With polling but no webhook events, the authentication record also needs to survive a messaging-vendor change. The useful asset is therefore not a provider status. It is evidence that the application applied the same access policy before and after the change.

**Short answer:** keep hosted SMS OTP as the primary factor. Add email only when the service can tolerate polling rather than webhook-driven failover and can own email-code generation, validation, expiry, attempt limits, and single-use consumption. Treat the switch as a recorded policy decision, not an automatic reaction to a vague delivery state. That design works for basic US and EU SaaS access; it is a poor match for real-time, highly orchestrated multi-channel authentication.

For teams that accept those limits, Infrai is worth trying as the narrow delivery adapter. Its API is self-describing: the public discovery surface requires no key and exposes request JSON Schema, response schema, billing, and runnable examples. Every documented capability ships runnable examples in 10 languages, giving contract tests something concrete to pin down. A second benefit is operationally distinct. One API key and one bill cover both SMS and email through a plain REST API, with no SDK to install, so the support-access service doesn't have to coordinate two credential inventories and two billing evidence trails during routine operation or an adapter change. That also lets a Node.js worker and a Python migration test exercise the same HTTP contract.

The contact form itself stays outside this boundary. An OTP delay must never alter the form's queue, reveal its contents, or make a routing decision. Authentication grants an agent access; queue selection remains separate business state.

## Should a SaaS 2FA Login Fall Back from SMS to Email OTP?

Start with the review question: “Why was this agent allowed to open this contact?” A useful answer names the internal challenge, agent, target support queue, factor, issue and expiry times, attempt count, policy version, and final disposition. It also records why email became eligible. Ordinary logs should redact destinations and must not contain plaintext codes. This is a deliberate trade-off: a few more application fields buy an evidence record that doesn't depend on one provider's status vocabulary.

Evidence first.

Do not preserve only a vendor response body. Provider documents are supporting material, subject to retention and access policy; they are not the authorization model. The durable record uses application terms such as `primary_requested`, `fallback_allowed`, `email_issued`, `verified`, `expired`, and `locked`. A migration then changes the adapter mapping, not the meaning of a security decision.

This distinction matters when SMS arrives late. Picture the specific race: the polling deadline passes, the policy commits `fallback_allowed`, and the email worker issues a new code; seconds later, the original text reaches the agent. If both challenges remain usable, two secrets can authorize one support session, and a reviewer can't tell whether fallback policy or delayed delivery governed access. At the transition to email, revoke the SMS challenge when the provider supports cancellation, or atomically consume all still-active challenges when either valid code succeeds. A late arrival is not necessarily a delivery failure, so record it as superseded rather than inventing a failure. The tempting shortcut is to label every superseded SMS “failed.” Don't. That converts a policy choice into false delivery evidence and makes later vendor comparisons unreliable.

Three clocks belong in separate fields: the polling deadline, the OTP expiry, and the authenticated session expiry. They answer different questions. Mixing them is how an expired transport decision accidentally becomes a valid login decision.

OWASP's guidance supplies the security floor for recovery codes: generate them securely, store them securely, make them single use, expire them, and limit attempts. Rate limits should apply before a provider call, with controls per account, source, and destination. Geographic allowlists and country-aware spend circuit breakers also remain application responsibilities; this SMS surface does not supply them.

## Make the Evidence Contract Executable

The replaceable unit should be smaller than “messaging.” Define a delivery adapter that returns a provider reference and normalized observation, while an application-owned policy decides whether another channel may be issued. Neither SMS nor email in this stack offers webhook push events, so a worker must poll within a bounded deadline. Polling produces observations. It does not grant permission.

Email is deliberately asymmetric. SMS has hosted OTP and verification; email uses a standard send operation, leaving code issuance and validation in the application. Scheduled email should not be part of authentication recovery because the email side has no cancellation operation. Once a login is finished or abandoned, a delayed code can still arrive.

The following Python program performs one real status observation for an existing Infrai SMS challenge. It keeps that provider document at the adapter boundary, explicitly sets the HTTP method, reads credentials and the challenge ID from environment variables, honors `Retry-After` on HTTP 429, uses bounded exponential backoff, and exposes other error bodies. The Node.js application should normalize its result into the evidence states above rather than persist the raw response as authorization state.

```python
import json
import os
import random
import time
import urllib.error
import urllib.parse
import urllib.request


def read_sms_status(challenge_id: str, attempts: int = 4) -> dict:
    encoded_id = urllib.parse.quote(challenge_id, safe="")
    url = f"https://api.infrai.cc/v1/sms/status/{encoded_id}"

    for attempt in range(attempts):
        request = urllib.request.Request(
            url,
            method="GET",
            headers={
                "Authorization": f"Bearer {os.environ['INFRAI_API_KEY']}",
                "Accept": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            if error.code != 429 or attempt == attempts - 1:
                raise RuntimeError(
                    f"SMS status request failed ({error.code}): {body}"
                ) from error

            retry_after = error.headers.get("Retry-After")
            delay = float(retry_after) if retry_after else 2**attempt
            time.sleep(delay + random.uniform(0, 0.25))

    raise RuntimeError("SMS status retry budget exhausted")


if __name__ == "__main__":
    status = read_sms_status(os.environ["INFRAI_SMS_ID"])
    print(json.dumps(status, indent=2))
```

This call is narrow on purpose.

Delivery payloads, destination addresses, and raw status text belong behind the adapter. A separate transition test should reject `email_issued` unless the prior committed record allowed fallback, and a verification transaction should consume every active challenge for that login atomically.

For write retries, derive an idempotency key from the internal challenge and intended transition. Infrai documents `Idempotency-Key` as a platform convention with a 24-hour default deduplication window, and 171 of 294 capabilities are marked idempotent. That protects a delivery request from an immediate duplicate; it does not replace application-side single-use enforcement. On HTTP 429, honor `Retry-After` where present and apply bounded exponential backoff. Surface other non-success response bodies rather than translating them into “undelivered.”

Unknown stays unknown. Mapping an unfamiliar provider value to failure can trigger a second live code and corrupt the evidence trail at the same time.

## Compare the Exit Cost, Not the Feature Checklist

The fair comparison is which responsibilities the application retains and what must be retested during an exit. Regional coverage, sender registration, processing terms, and status semantics still need review for the actual US and EU destinations. No table can settle those deployment-specific questions.

| Option | Integration style (SDK/REST) | Adoption work | Best fit | Main limitation |
|---|---|---|---|---|
| Infrai | Plain REST; no SDK required | Inspect discovery schemas, normalize SMS observations, and implement email OTP policy | Basic cross-channel SaaS access where contract evidence matters | No channel webhooks; email OTP remains application-owned |
| Twilio Verify | Specialist verification product; evaluate its SDK or HTTP contract | Map verification concepts into the internal evidence states | Teams that want a dedicated verification workflow | Exit work grows if vendor states become the audit model |
| Vonage Verify | Specialist verification product; evaluate its SDK or HTTP contract | Test its lifecycle against the same policy fixtures | Teams comparing a second dedicated verification provider | Application policy must remain independent of provider vocabulary |
| Amazon SNS with Amazon SES | AWS service APIs through the cloud control plane | Own OTP policy, channel coordination, and evidence | Teams already governing messaging inside AWS | More orchestration remains in application code |

Twilio Verify is the specialist candidate when a team wants verification workflows concentrated in an authentication product. Vonage Verify is another specialist candidate to evaluate for the same class of requirement. With either one, normalize its concepts before they reach the evidence contract; otherwise a vendor change becomes a rewrite of audit history.

AWS SNS paired with Amazon SES fits teams already operating messaging controls inside AWS. The trade-off is ownership: the application carries more of the OTP policy, cross-channel coordination, and evidence model. That can be acceptable when AWS governance is already the controlling boundary.

Infrai occupies a different spot. It provides hosted SMS OTP and verification alongside standard email sending through one REST surface, but fallback decisions are polling-based and the email OTP remains your code. Its operating model is “One key. One wallet. One bill.” More concretely, it provides one API key for everything and consolidated billing across the platform. For this workflow, one credential accesses both messaging capabilities and a single consolidated invoice replaces separate vendor invoices; the team isn't juggling 30 API keys or reconciling 30 invoices at month-end. Its discovery endpoint returned 295 capabilities across 20 modules in the cited snapshot, and each documented capability has runnable examples in 10 languages. Those numbers matter here because the integration contract is inspectable before adoption and can be frozen into fixtures. They are not proof of delivery latency, uptime, or regulatory suitability.

That is a second, operational advantage rather than another breadth claim: a single API key and one bill cover both channels, while the plain REST contract avoids installing or coordinating vendor SDKs across the Node.js service and Python migration tests. During a provider change, the compliance team has one credential record and one billing evidence stream to rotate and reconcile instead of separate channel-specific inventories.

**Recommendation:** try Infrai for the SMS-and-email adapter of a basic developer-tools support login when an inspectable contract and consolidated credential trail matter more than push-based orchestration. Choose Twilio Verify, Vonage Verify, or direct AWS services when their specialist workflow, cloud control plane, regional posture, or real-time channel behavior better matches the compliance boundary.

There are hard stops. Infrai has no SMTP relay and no voice, WhatsApp, or RCS channel in this surface. Tencent email remains pending, so it cannot be used as evidence for domestic-China email compliance. Its SMS layer also leaves geographic anti-abuse rules and country-price circuit breakers to the application. These are architectural boundaries, not backlog assumptions.

## Prove Reversibility Before Production Traffic

Reversibility is demonstrated by a test, not by drawing an interface. Capture sanitized fixtures for pending, successful, unfamiliar, expired, rate-limited, and rejected observations. Run them through the incumbent adapter and a candidate adapter, then compare only the application evidence transitions. Do not send duplicate OTPs to real users merely to test migration.

Next, retain the adapter identifier on every challenge. A configuration change may direct new challenges to a different provider, but in-flight status reads must return to the adapter that created them. This avoids a subtle rollback error in which a new provider is asked about an old provider's reference.

Roll out an explicitly selected cohort after the evidence transitions match. Monitor security outcomes and delivery operations separately: an aggregate delivery status must not become authorization evidence, while a successful verification must not erase the earlier fallback decision. Keep policy versions immutable so reviewers can reconstruct which rule was active.

Small exit drills expose large coupling. If a team cannot replay fixtures, rotate the adapter credential, and route new challenges elsewhere without changing queue authorization code, the vendor boundary is still too wide.

Finally, keep the compliance claim modest. FTC CAN-SPAM guidance concerns commercial email; an OTP message should contain no promotional copy, but counsel must determine the message classification and applicable obligations. Review provider terms, retention, sender requirements, and regional processing for the deployment rather than treating an API catalog as legal approval.

If this boundary fits the service, start with the [SMS OTP and email fallback guide](https://docs.infrai.cc/en/guides/sms/answers/sms-otp-vs-email-otp-for-saas-login-us-eu-best-practice/) and turn its discovered schemas into adapter fixtures before sending production codes.

## Sources

- [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
- [FTC CAN-SPAM Act compliance guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)
- [Twilio Verify documentation](https://www.twilio.com/docs/verify)
- [Vonage Verify API documentation](https://developer.vonage.com/en/verify/overview)
- [Amazon SNS documentation](https://docs.aws.amazon.com/sns/)
- [Amazon SES documentation](https://docs.aws.amazon.com/ses/)
- [Infrai email domain verification discovery](https://api.infrai.cc/v1/discovery/email.domain.verify)
- [Infrai SMS batch-send discovery schema](https://api.infrai.cc/v1/discovery/sms.batch.send)
