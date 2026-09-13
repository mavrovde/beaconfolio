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
    // i.e. the open-redirect passthrough itself. A spec that pins the
    // vulnerability is why the fix needed a test change, and why the old
    // assertion had to be found rather than left to fail later.
    it('reduces an absolute URL to its path — no redirect off-origin', () => {
        (environment as any).apiUrl = 'https://api.example.org';
        expect(service.getDownloadUrl('http://evil.example.com/cv.pdf'))
            .toBe('https://api.example.org/cv.pdf');
    });

    it('strips a protocol-relative URL to its path too', () => {
        (environment as any).apiUrl = 'https://api.example.org';
        expect(service.getDownloadUrl('//evil.example.com/cv.pdf'))
            .toBe('https://api.example.org/cv.pdf');
    });

    it('keeps the query string when reducing an absolute URL', () => {
        (environment as any).apiUrl = 'https://api.example.org';
        expect(service.getDownloadUrl('https://evil.example.com/cv.pdf?t=1'))
            .toBe('https://api.example.org/cv.pdf?t=1');
    });

    it('normalises a path that lacks a leading slash', () => {
        (environment as any).apiUrl = 'https://api.example.org';
        expect(service.getDownloadUrl('cv.pdf')).toBe('https://api.example.org/cv.pdf');
    });
});
