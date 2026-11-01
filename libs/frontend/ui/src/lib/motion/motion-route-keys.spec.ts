import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GuardsCheckEnd, provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { detailParamKey } from './motion-route-keys';
import { Route } from '@angular/router';

@Component({ standalone: true, template: '' })
class EmptyPage {}

describe('detailParamKey', () => {
  it('reads decoded params from the pending target and returns null outside the list route', async () => {
    const listConfig: Route = { path: 'x', children: [{ path: ':id', component: EmptyPage }] };
    TestBed.configureTestingModule({ providers: [provideRouter([listConfig, { path: 'other', component: EmptyPage }])] });
    const router = TestBed.inject(Router);
    // The target uses the same route config object as the live list route.
    const keys: Array<string | null> = [];
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/x/a%2Fb');
    const activeList = router.routerState.root.firstChild;
    expect(activeList).not.toBeNull();
    if (!activeList) throw new Error('The list route did not activate');
    const keyOf = detailParamKey(activeList, 'id');
    router.events.subscribe((event) => {
      if (event instanceof GuardsCheckEnd && event.shouldActivate) {
        keys.push(keyOf(event.state)?.key ?? null);
      }
    });
    await harness.navigateByUrl('/x/a%2Fc');
    await harness.navigateByUrl('/other');
    expect(keys).toEqual(['a/c', null]);
    expect(detailParamKey(activeList, 'id')(router.routerState.snapshot)).toBeNull();
  });
});
