import React, { Suspense } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AppRootProps, PluginType } from '@grafana/data';
import { render, act } from '@testing-library/react';

jest.mock('@grafana/runtime', () => {
  const actual = jest.requireActual('@grafana/runtime');
  return {
    ...actual,
    getBackendSrv: jest.fn(() => ({
      get: jest.fn().mockResolvedValue({ data: [] }),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
    })),
  };
});

jest.mock('../../pages/PageOne', () => ({
  __esModule: true,
  default: () => <div data-testid="mock-page-one">Mock Page One</div>,
}));



describe('Components/App', () => {
  let props: AppRootProps;

  beforeEach(() => {
    jest.resetAllMocks();

    props = {
      basename: 'a/sample-app',
      meta: {
        id: 'sample-app',
        name: 'Sample App',
        type: PluginType.app,
        enabled: true,
        jsonData: {},
      },
      query: {},
      path: '',
      onNavChanged: jest.fn(),
    } as unknown as AppRootProps;
  });

  test('renders without an error"', async () => {
    await expect(
      import('./App').then(async (mod) => {
        const TestApp = mod.default;
        await act(async () => {
          render(
            <MemoryRouter>
              <Suspense fallback={null}>
                <TestApp {...props} />
              </Suspense>
            </MemoryRouter>
          );
        });
      })
    ).resolves.toBeUndefined();
  });
});
