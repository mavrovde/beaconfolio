import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { CvService } from './cv.service';
import { environment } from '../../environments/environment';

describe('CvService', () => {
    let service: CvService;
    let httpMock: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [HttpClientTestingModule],
            providers: [CvService]
        });
        service = TestBed.inject(CvService);
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
        httpMock.verify();
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should send CV request', () => {
        const mockRequest = {
            name: 'John Doe',
            email: 'john@example.com',
            message: 'Hello',
            company: 'Test Corp'
        };

        const mockResponse = {
            success: true,
            message: 'Sent',
            download_url: `${environment.apiPrefix}/static/cv.pdf`
        };

        service.requestCv(mockRequest).subscribe(response => {
            expect(response).toEqual(mockResponse);
        });

        const req = httpMock.expectOne(`${environment.apiUrl}${environment.apiPrefix}/cv/request`);
        expect(req.request.method).toBe('POST');
        expect(req.request.body).toEqual(mockRequest);
        req.flush(mockResponse);
    });

    it('should format download URL', () => {
        const originalApiUrl = environment.apiUrl;
        (environment as any).apiUrl = 'http://localhost:8000';

        const relative = `${environment.apiPrefix}/download/cv.pdf`;
        const expected = `http://localhost:8000${relative}`;
        expect(service.getDownloadUrl(relative)).toBe(expected);

        (environment as any).apiUrl = originalApiUrl;
    });

    it('should return relative URL as is if environment.apiUrl is missing', () => {
        // Mock environment.apiUrl to be empty
        const originalApiUrl = environment.apiUrl;
        (environment as any).apiUrl = '';

        const relative = `${environment.apiPrefix}/download/cv.pdf`;
        expect(service.getDownloadUrl(relative)).toBe(relative);

        // Restore
        (environment as any).apiUrl = originalApiUrl;
    });

    // STALE ASSERTION REPLACED (#376): this used to pin
    //   expect(service.getDownloadUrl(absolute)).toBe(absolute)
    // i.e. the open-redirect passthrough itself.
    //
    // These cases run with apiUrl = '' — the value BOTH shipped environments
    // actually use. An earlier version of this block set it to a host, which
    // tested a configuration production never runs and let the live bypass
    // through review.
    describe('getDownloadUrl — open redirect (production config, apiUrl empty)', () => {
        beforeEach(() => {
            (environment as any).apiUrl = '';
        });

        it.each([
            ['http://evil.example.com/cv.pdf', '/cv.pdf'],
            ['//evil.example.com/cv.pdf', '/cv.pdf'],
            ['/\\evil.example.com/cv.pdf', '/cv.pdf'],
            ['\\\\evil.example.com/cv.pdf', '/cv.pdf'],
            ['https://evil.example.com/cv.pdf?t=1', '/cv.pdf?t=1'],
            ['javascript:alert(1)', '/alert(1)'],
        ])('reduces %s to a same-origin path', (input, expected) => {
            expect(service.getDownloadUrl(input)).toBe(expected);
        });

        it('leaves an ordinary relative path alone', () => {
            expect(service.getDownloadUrl('/api/app/cv/download')).toBe('/api/app/cv/download');
        });

        it('normalises a path with no leading slash', () => {
            expect(service.getDownloadUrl('cv.pdf')).toBe('/cv.pdf');
        });

        it('falls back to the root on a malformed URL that throws', () => {
            expect(service.getDownloadUrl('http://')).toBe('/');
        });
    });

    it('prepends apiUrl when one is configured', () => {
        (environment as any).apiUrl = 'https://api.example.org';
        expect(service.getDownloadUrl('http://evil.example.com/cv.pdf'))
            .toBe('https://api.example.org/cv.pdf');
    });
});
