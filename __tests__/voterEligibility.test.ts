import {memberIsEligibleVoter} from '../src/screens/main/governanceDisplay';

const SELF = 'rrn1self';

describe('memberIsEligibleVoter (ADR-0015)', () => {
  it('an established member may vote, grace or not', () => {
    expect(
      memberIsEligibleVoter({ownAddress: SELF, established: true, inGrace: false, founders: []}),
    ).toBe(true);
    expect(
      memberIsEligibleVoter({ownAddress: SELF, established: true, inGrace: true, founders: []}),
    ).toBe(true);
  });

  it('a founder may vote while the community is in grace', () => {
    expect(
      memberIsEligibleVoter({
        ownAddress: SELF,
        established: false,
        inGrace: true,
        founders: [SELF, 'rrn1other'],
      }),
    ).toBe(true);
  });

  it('a New non-founder in grace may not vote', () => {
    expect(
      memberIsEligibleVoter({
        ownAddress: SELF,
        established: false,
        inGrace: true,
        founders: ['rrn1other'],
      }),
    ).toBe(false);
  });

  it('a founder may NOT vote once grace has ended (only established members do)', () => {
    expect(
      memberIsEligibleVoter({
        ownAddress: SELF,
        established: false,
        inGrace: false,
        founders: [SELF],
      }),
    ).toBe(false);
  });

  it('an unknown own address is never eligible via the founder path', () => {
    expect(
      memberIsEligibleVoter({
        ownAddress: undefined,
        established: false,
        inGrace: true,
        founders: [SELF],
      }),
    ).toBe(false);
  });
});
