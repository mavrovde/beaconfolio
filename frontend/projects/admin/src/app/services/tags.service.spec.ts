import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TagsService } from './tags.service';
import { environment } from '../../environments/environment';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('TagsService', () => {
    let service: TagsService;
    let httpMock: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [HttpClientTestingModule],
            providers: [TagsService],
        });
        service = TestBed.inject(TagsService);
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
        httpMock.verify();
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should get all tags', () => {
        const mockResponse = {
            items: [
                { name: 'Angular', count: 5 },
                { name: 'Python', count: 3 },
            ],
            total: 2,
            page: 1,
            page_size: 10,
            total_pages: 1
        };

        service.getAllTags().subscribe((response) => {
            expect(response).toEqual(mockResponse);
        });

        const req = httpMock.expectOne((req) => req.url.includes(environment.apiPrefix + '/tags'));
        expect(req.request.method).toBe('GET');
        expect(req.request.params.get('page')).toBe('1');
        expect(req.request.params.get('page_size')).toBe('10');
        req.flush(mockResponse);
    });

    it('should get tags with search param', () => {
        const mockResponse = { items: [], total: 0, page: 1, page_size: 10, total_pages: 0 };
        const query = 'test';

        service.getAllTags(1, 10, 'count', 'desc', query).subscribe(response => {
            expect(response).toEqual(mockResponse);
        });

        const req = httpMock.expectOne(req =>
            req.url.includes(environment.apiPrefix + '/tags') && req.params.get('search') === query
        );
        expect(req.request.method).toBe('GET');
        req.flush(mockResponse);
    });

    it('should rename tag', () => {
        const oldName = 'Angular';
        const newName = 'AngularJS';
        const mockResponse = { success: true };

        service.renameTag(oldName, newName).subscribe((response) => {
            expect(response).toEqual(mockResponse);
        });

        const req = httpMock.expectOne(`${environment.apiUrl}${environment.apiPrefix}/tags/${oldName}`);
        expect(req.request.method).toBe('PUT');
        expect(req.request.body).toEqual({ new_name: newName });
        req.flush(mockResponse);
    });

    it('should delete tag', () => {
        const tagName = 'Python';
        const mockResponse = { success: true };

        service.deleteTag(tagName).subscribe((response) => {
            expect(response).toEqual(mockResponse);
        });

        const req = httpMock.expectOne(`${environment.apiUrl}${environment.apiPrefix}/tags/${tagName}`);
        expect(req.request.method).toBe('DELETE');
        req.flush(mockResponse);
    });
});
