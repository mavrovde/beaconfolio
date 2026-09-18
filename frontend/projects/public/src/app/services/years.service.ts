import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, shareReplay, catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface YearsResponse {
    years: number[];
}

@Injectable({
    providedIn: 'root',
})
export class YearsService {
    private http = inject(HttpClient);

    private apiUrl = `${environment.apiUrl}${environment.apiPrefix}/cv/years`;
    private years$: Observable<number[]> | null = null;

    getYears(): Observable<number[]> {
        if (!this.years$) {
            this.years$ = this.http.get<YearsResponse>(this.apiUrl).pipe(
                map((res) => res.years),
                catchError((err) => {
                    console.error('Failed to load years', err);
                    return of([]);
                }),
                shareReplay(1),
            );
        }
        return this.years$;
    }
}
