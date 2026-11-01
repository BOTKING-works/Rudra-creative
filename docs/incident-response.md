# Incident response quick guide

This is an operational starter checklist; adapt it to the business, legal duties, and provider contracts before launch.

## 1. Triage and containment

- Record when the issue was detected, the affected service, observed customer/business impact, and an incident owner.
- For suspected credential exposure, restrict the affected account/service, rotate the secret using the provider's procedure, invalidate sessions where relevant, and inspect audit/provider logs.
- For suspected data exposure, disable the affected route or object access at the narrowest safe scope. Preserve evidence; do not delete logs or backups to hide the event.
- For payment integrity concerns, pause new payment initiation if safe, do not manually mark orders paid, and reconcile provider records against internal order/payment-attempt references.
- For abusive uploads, disable new uploads or tighten limits, quarantine affected assets, and preserve metadata for investigation. Never execute submitted files.

## 2. Investigation

Collect relevant timestamps, request IDs, deployment SHA, container image digests, audit events, provider event IDs, and system metrics. Redact tokens, passwords, OTPs, payment secrets, and unnecessary personal data. Limit evidence access to named responders.

## 3. Recovery

Patch and review the root cause, rotate impacted credentials, restore from backups only with explicit approval, verify data consistency and object ownership, and run smoke/security tests before restoring traffic. Reconcile uncertain payment events with the provider using verified server-side records.

## 4. Communication and follow-up

Use owner-approved communications and comply with applicable contractual/regulatory obligations. Record scope, timeline, decisions, data-loss window, remediation, and lessons learned. Schedule follow-up actions with owners and due dates. Avoid claiming there was no impact until evidence supports that conclusion.

## 5. Readiness

Before launch, name a primary and backup responder, ensure out-of-band access to provider consoles, test a credential rotation, and run a restoration drill. No incident-response exercise has been conducted by this starter repository.
