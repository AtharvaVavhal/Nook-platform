# Task 4E — Check-in and Check-out Management: Implementation Plan

## Executive Summary

The backend for Check-in/Check-out is largely complete with robust validation and lifecycle management. The frontend has partial implementation with several TypeScript errors that need fixing. The main work involves fixing TypeScript errors, completing missing API methods, and ensuring proper integration with Admissions, Bookings, and Finance modules.

---

## Current State Analysis

### Backend (Complete ✓)
- **CheckIn Model**: id, organizationId, admissionId, residentId, bedId, bookingId, checkInAt, status (ACTIVE/CHECKED_OUT), notes, createdAt, updatedAt
- **CheckOut Model**: id, checkInId, residentId, bedId, bookingId, checkOutAt, reason, notes, createdAt, updatedAt
- **CheckInService**: create, findAll, findOne, update, cancel, checkOut
- **CheckInController**: POST /check-ins, GET /check-ins, GET /check-ins/:id, PUT /check-ins/:id, DELETE /check-ins/:id, POST /check-ins/:id/check-out
- **Validation**: Admission must be ADMITTED, booking CONFIRMED, duplicate check-in prevention, bed/booking/resident matching

### Frontend (Partially Complete - Has TypeScript Errors)
- **CheckIns.tsx**: CheckInList, CheckInNew, CheckInDetail, ActiveResidents, CheckOutHistory components exist but have TypeScript errors
- **opsApi.ts**: CheckIn/CheckOut types defined, checkIns API methods partially complete (missing get, update methods; checkOut uses old signature)
- **opsRoute.ts**: Routes for check-ins and check-in detail exist
- **App.tsx**: CheckInList, CheckInNew, CheckInDetail, ActiveResidents, CheckOutHistory wired up
- **Sidebar**: "Check-ins" navigation link exists

---

## Implementation Plan

### Phase 1: Fix TypeScript Errors in CheckIns.tsx (Priority: Critical)

**Issues to Fix:**
1. **Duplicate `EMPTY_CHECKIN` declaration** (lines 116 and 203) - Remove duplicate
2. **Duplicate `CheckInNew` function** (lines 122 and 279) - Remove duplicate
3. **Duplicate `setField` function** (lines 225 and 220) - Remove duplicate
4. **Duplicate `filteredAdmissions` variable** (lines 245 and 244) - Remove duplicate
5. **Type mismatch in `CheckInForm`**: `setField('status')` but `CheckInInput` doesn't have status field
6. **Type mismatch in `CheckInDetail`**: `changeStatus` passes string but expects `'ACTIVE' | 'CHECKED_OUT'`
7. **Missing properties in CheckIn type**: `admissionDate`, `checkOutAt`, `reason` missing from CheckIn interface
8. **CheckOutHistory**: References `c.booking`, `c.checkOutAt`, `c.reason` which don't exist on CheckIn type
9. **CheckOutHistory**: Uses `opsApi.checkIns.list()` but API expects `checkIns.list()` with params

**Action Items:**
- Fix CheckIn interface to include all backend fields (checkOutAt, reason, admissionDate, etc.)
- Add CheckOutInput type to match backend DTO
- Fix CheckInForm to not include status field (backend sets ACTIVE on create)
- Fix CheckInDetail changeStatus to use proper status transition
- Update CheckOutHistory to use correct API call and type

### Phase 2: Complete opsApi.ts Check-in Methods (Priority: High)

**Missing/Incorrect Methods:**
1. `checkIns.get(id)` - Missing, needed for CheckInDetail
2. `checkIns.update(id, body)` - Missing, needed for CheckInDetail status change
3. `checkIns.checkOut(id, body)` - Wrong signature, should accept `CheckOutInput`
4. `checkIns.cancel(id)` - Exists as DELETE but mapped to cancel method

**Required Changes:**
```typescript
checkIns: {
  list: (p: { status?: string; residentId?: string; bedId?: string; fromDate?: string; toDate?: string; page?: number; limit?: number }) =>
    request<Paged<CheckIn>>('GET', `/check-ins${qs(p)}`),
  get: (id: string) => request<CheckIn>('GET', `/check-ins/${id}`),
  checkIn: (body: CheckInInput) => request<CheckIn>('POST', '/check-ins', body),
  update: (id: string, body: Partial<CheckInInput>) => request<CheckIn>('PUT', `/check-ins/${id}`, body),
  cancel: (id: string) => request<CheckIn>('DELETE', `/check-ins/${id}`),
  checkOut: (id: string, body: CheckOutInput) => request<CheckOut>('POST', `/check-ins/${id}/check-out`, body),
}
```

### Phase 3: Update CheckIn/CheckOut Type Definitions (Priority: High)

**Current CheckIn interface missing fields:**
- `checkOutAt?: string`
- `reason?: string | null`
- `notes?: string | null`
- `admission?: { id: string; status: string; admissionDate: string }`
- `bed?: { label: string; room?: { label: string } | null }`

**Add CheckOutInput type:**
```typescript
export interface CheckOutInput {
  checkOutAt: string;
  reason?: string | null;
  notes?: string | null;
}
```

### Phase 4: Implement Active Residents Screen (Priority: High)

**Current State:** `ActiveResidents` component exists in CheckIns.tsx but not accessible via sidebar navigation.

**Required:**
1. Add "Active Residents" link to sidebar navigation (under Check-ins)
2. Ensure ActiveResidents component works correctly (already implemented)
3. Verify it shows currently checked-in residents with property/room/bed details

### Phase 5: Check-out History Screen (Priority: Medium)

**Current State:** `CheckOutHistory` component exists but uses wrong API call and type.

**Required:**
1. Fix `CheckOutHistory` to use correct API endpoint
2. Add "Check-out History" link to sidebar (or as tab in Check-ins)
4. Ensure CheckOut type includes all necessary fields for display

### Phase 6: Verify Bed Availability Integration (Priority: High)

**Current State:** `getAvailableBeds` in booking.service.ts filters by `operationalStatus: 'IN_SERVICE'` and `room: { archivedAt: null }` but doesn't check for active check-ins.

**Required:** Verify that `getAvailableBeds` correctly excludes beds with active check-ins.

From code review: `getAvailableBeds` in booking.service.ts already checks for overlapping bookings but NOT active check-ins. Need to add check for active check-ins.

### Phase 7: Finance Integration Verification (Priority: Medium)

**Current State:** FinanceService.generateMonthly() uses check-ins with status 'ACTIVE' or checked-out during period.

**Required:** Document and verify the integration contract:
- Which date determines first invoice eligibility? (checkInAt)
- How future-dated check-ins handled? (excluded until checkInAt)
- What happens after early check-out? (stay billed for full month)
- Next monthly invoice after check-out? (No - full month billed)
- Already-issued invoices after check-out? (Not affected)

### Phase 8: KYC Integration Boundary (Priority: Medium)

**Requirements:**
- Check if KYC module exists (not found in codebase)
- Document integration point: CheckInService.create() should verify KYC status
- If not implemented, document integration point for future
- Do not create fake KYC

### Phase 8: Sidebar Navigation Updates (Priority: Medium)

**Current Sidebar Links:**
- Check-ins (exists)

**Add to Sidebar:**
- Active Residents (under Check-ins or separate)
- Check-out History (under Check-ins or separate)

### Phase 9: Testing & Verification (Priority: High)

**Required Tests:**
1. **Unit Tests**: Check-in eligibility, duplicate check-in prevention, check-out validation, bed occupancy calculation, booking and admission consistency, early check-out behavior, finance eligibility boundaries
2. **API Integration Tests**: Valid check-in, check-in without admission, check-in with cancelled booking, check-in with out-of-service bed, check-in with archived inventory, duplicate active check-in, valid check-out, duplicate check-out, cross-organization access, bed availability after check-out
4. **Concurrency Tests**: Test simultaneous check-in requests for same bed and concurrent booking/check-in operations
5. **Browser Tests**: Eligible admissions, check-in creation, active residents, check-out, historical stays, validation failures, API errors, mobile layout

**Databases:** All tests against `nook_dev` (throwaway). No `nook_test` verification claimed.

---

## Clarifying Questions for User

1. **Check-in Time**: Should check-in time default to current time or be required input? (Currently required datetime-local input)

2. **Check-out Reason**: Should reason be required or optional? (Backend has optional reason)

3. **KYC Integration**: Is there an existing KYC module? If not, should we add a placeholder check in CheckInService.create()?

4. **Early Check-out Billing**: Confirm business rule - "full month billed regardless of early check-out" (current FinanceService bills full month)

5. **Sidebar Structure**: Should "Active Residents" and "Check-out History" be sub-items under "Check-ins" or top-level?

6. **Concurrency Testing**: Should we add automated concurrency tests or just document manual test procedure?

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| TypeScript errors block build | High | High | Fix incrementally, test after each fix |
| API contract mismatch | Medium | High | Verify against backend DTOs |
| Concurrency race conditions | Medium | High | Document limitation, plan DB constraint for Phase 2 |
| Finance integration breakage | Low | High | Verify generateMonthly logic unchanged |
| KYC requirement unclear | Medium | Medium | Document integration point, don't implement fake |

---

## Estimated Effort

| Phase | Effort | Dependencies |
|-------|--------|--------------|
| Phase 1: TypeScript fixes | 2-3 hours | None |
| Phase 2: opsApi updates | 1 hour | Phase 1 |
| Phase 3: Type definitions | 1 hour | Phase 1 |
| Phase 4: Active Residents UI | 1 hour | Phase 1-3 |
| Phase 5: Check-out History | 1 hour | Phase 1-3 |
| Phase 6: Bed availability | 1 hour | Backend change |
| Phase 7: Finance verification | 30 min | Read-only |
| Phase 8: KYC documentation | 30 min | Documentation |
| Phase 9: Testing | 2-3 hours | All phases |

**Total Estimated: 8-10 hours**

---

## Questions for User

1. **Should I proceed with this plan as outlined, or are there modifications?**
2. **Which items should be prioritized if time is constrained?**
3. **Should I create a separate PR for each phase or one combined PR?**
4. **Any specific UI/UX preferences for the check-in/check-out flows?**
5. **Should I add automated concurrency tests or just document manual test procedure?**