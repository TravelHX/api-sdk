import { ApiSdk } from '../../../../src/js/src/api-sdk';

describe('ApiSdk', () => {
  it('should create an instance', () => {
    const sdk = new ApiSdk();
    expect(sdk).toBeDefined();
  });
});

