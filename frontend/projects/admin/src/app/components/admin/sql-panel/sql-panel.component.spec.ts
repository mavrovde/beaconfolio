import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SqlPanelComponent } from './sql-panel.component';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TranslatePipe } from '@beaconfolio/shared';
import { MockTranslatePipe } from '@beaconfolio/shared/testing';
import { environment } from '../../../../environments/environment';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('SqlPanelComponent', () => {
    let component: SqlPanelComponent;
    let fixture: ComponentFixture<SqlPanelComponent>;
    let httpMock: HttpTestingController;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [SqlPanelComponent, HttpClientTestingModule, MockTranslatePipe],
        })
            .overrideComponent(SqlPanelComponent, {
                remove: { imports: [TranslatePipe] },
                add: { imports: [MockTranslatePipe] }
            })
            .compileComponents();

        fixture = TestBed.createComponent(SqlPanelComponent);
        component = fixture.componentInstance;
        httpMock = TestBed.inject(HttpTestingController);
        fixture.detectChanges();
    });

    afterEach(() => {
        httpMock.verify();
        vi.restoreAllMocks();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should execute query successfully', () => {
        component.query = 'SELECT * FROM users';
        component.executeQuery();

        const req = httpMock.expectOne(`${environment.apiPrefix}/admin/sql/execute`);
        expect(req.request.method).toBe('POST');
        expect(req.request.body).toEqual({ query: 'SELECT * FROM users' });

        const mockResponse = [{ id: 1, name: 'Test' }];
        req.flush(mockResponse);

        expect(component.result).toEqual(mockResponse);
        expect(component.columns).toEqual(['id', 'name']);
        expect(component.loading).toBe(false);
    });

    it('should handle execute query error', () => {
        component.query = 'INVALID QUERY';
        component.executeQuery();

        const req = httpMock.expectOne(`${environment.apiPrefix}/admin/sql/execute`);
        req.flush({ detail: 'Syntax Error' }, { status: 400, statusText: 'Bad Request' });

        expect(component.error).toBe('Syntax Error');
        expect(component.loading).toBe(false);
    });

    it('should not execute empty query', () => {
        component.query = '';
        component.executeQuery();
        httpMock.expectNone(`${environment.apiPrefix}/admin/sql/execute`);
    });

    it('should initiate backup download', () => {
        const createObjUrlSpy = vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:url');
        const revokeObjUrlSpy = vi.spyOn(window.URL, 'revokeObjectURL');
        const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click');

        component.backup();

        const req = httpMock.expectOne(`${environment.apiPrefix}/admin/sql/backup`);
        expect(req.request.method).toBe('GET');
        expect(req.request.responseType).toBe('blob');

        const mockBlob = new Blob(['SQL DUMP'], { type: 'application/sql' });
        req.flush(mockBlob, {
            headers: { 'Content-Disposition': 'attachment; filename="backup.sql"' },
            status: 200,
            statusText: 'OK'
        });

        expect(createObjUrlSpy).toHaveBeenCalled();
        expect(clickSpy).toHaveBeenCalled();
        expect(revokeObjUrlSpy).toHaveBeenCalled();
        expect(component.loading).toBe(false);
    });

    it('should handle backup error', () => {
        component.backup();
        const req = httpMock.expectOne(`${environment.apiPrefix}/admin/sql/backup`);
        req.flush(new Blob(['Server Error']), { status: 500, statusText: 'Internal Server Error' });

        expect(component.error).toContain('Backup failed');
        expect(component.result).toBeTruthy();
        expect(component.loading).toBe(false);
    });

    it('should restore database successfully', () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => { });

        const file = new File(['SQL COMMANDS'], 'backup.sql', { type: 'application/sql' });
        component.restore(file);

        const req = httpMock.expectOne(`${environment.apiPrefix}/admin/sql/restore`);
        expect(req.request.method).toBe('POST');

        req.flush({ message: 'Restored', output: 'Done' });

        expect(component.result).toEqual([{ message: 'Restored', output: 'Done' }]);
        expect(component.loading).toBe(false);
        expect(alertSpy).toHaveBeenCalledWith('Database restored successfully!');
    });

    it('should abort restore if user cancels', () => {
        vi.spyOn(window, 'confirm').mockReturnValue(false);
        const file = new File([''], 'backup.sql');
        component.restore(file);
        httpMock.expectNone(`${environment.apiPrefix}/admin/sql/restore`);
    });

    it('should handle restore error without generic detail property', () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const file = new File([''], 'backup.sql');
        component.restore(file);

        const req = httpMock.expectOne(`${environment.apiPrefix}/admin/sql/restore`);
        // Test fallback message if err.error.detail is not provided
        req.flush({ message: 'Crash' }, { status: 500, statusText: 'Error' });

        expect(component.error).toBe('Restore failed');
        expect(component.loading).toBe(false);
    });

    it('should handle backup downloading without Content-Disposition', () => {
        vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:url');
        vi.spyOn(window.URL, 'revokeObjectURL');
        const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click');

        component.backup();

        const req = httpMock.expectOne(`${environment.apiPrefix}/admin/sql/backup`);

        const mockBlob = new Blob(['SQL DUMP'], { type: 'application/sql' });
        req.flush(mockBlob, {
            headers: {},
            status: 200,
            statusText: 'OK'
        });

        // The default fallback filename is backup.sql
        expect(clickSpy).toHaveBeenCalled();
        expect(component.result?.[0]?.filename).toBe('backup.sql');
    });

    it('should call restore when file selected', () => {
        const file = new File([''], 'backup.sql');
        const event = { target: { files: [file] } };
        const restoreSpy = vi.spyOn(component, 'restore');

        component.onFileSelected(event);

        expect(restoreSpy).toHaveBeenCalledWith(file);
    });

    it('should check error message fallback', () => {
        component.query = 'q';
        component.executeQuery();
        const req = httpMock.expectOne(`${environment.apiPrefix}/admin/sql/execute`);
        req.flush({}, { status: 500, statusText: 'Error' });
        expect(component.error).toBe('Execution failed');
    });

    it('should check empty data handling', () => {
        component.query = 'q';
        component.executeQuery();
        const req = httpMock.expectOne(`${environment.apiPrefix}/admin/sql/execute`);
        req.flush([]);
        expect(component.result).toEqual([]);
        expect(component.columns).toEqual([]);
    });
});
