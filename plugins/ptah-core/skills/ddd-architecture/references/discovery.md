# Discovery Questions

Load only when the caller has not already answered domain discovery. The rule for `saas-workspace-initializer` Step a2 (do not re-ask Round 1) lives in SKILL.md, section "When to Engage User". Skip any question that is already answered.

1. **Domain Complexity**
   - "What are your core business entities and their relationships?"
   - "Which operations are most critical to get right?"
   - "Are there complex business rules or validations?"

2. **Bounded Contexts**
   - "Are there distinct business areas that use different terminology?"
   - "Which teams will own which parts of the system?"
   - "Do you have existing systems that define boundaries?"

3. **Scale & Performance**
   - "Which read operations are most frequent?"
   - "Are there operations that need eventual consistency?"
   - "Do you need audit trails for business operations?"
