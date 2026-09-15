import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TagManagerComponent } from './tag-manager.component';
import { TagsService } from '../../../services/tags.service';
import { of, throwError, Subject } from 'rxjs';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

describe('TagManagerComponent', () => {
    let component: TagManagerComponent;
    let fixture: ComponentFixture<TagManagerComponent>;
    let tagsServiceSpy: { getAllTags: Mock; renameTag: Mock; deleteTag: Mock };

    const mockPaginatedResponse = {
        items: [
            { name: 'Angular', count: 5 },
            { name: 'Python', count: 3 },
        ],
        total: 2,
        page: 1,
        page_size: 10,
        total_pages: 1
    };

    beforeEach(async () => {
        tagsServiceSpy = {
            getAllTags: vi.fn().mockReturnValue(of(mockPaginatedResponse)),
            renameTag: vi.fn(),
            deleteTag: vi.fn(),
        };

        await TestBed.configureTestingModule({
            imports: [TagManagerComponent],
            providers: [{ provide: TagsService, useValue: tagsServiceSpy }],
        }).compileComponents();

        fixture = TestBed.createComponent(TagManagerComponent);
        component = fixture.componentInstance;
        // Do NOT call detectChanges here to allow individual tests to setup mocks first
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should load tags on init', () => {
        fixture.detectChanges(); // Triggers ngOnInit
        expect(tagsServiceSpy.getAllTags).toHaveBeenCalled();
        expect(component.table.items).toEqual(mockPaginatedResponse.items);
        expect(component.loading).toBe(false);
    });

    it('should show loading state', () => {
        const subject = new Subject<any>();
        tagsServiceSpy.getAllTags.mockReturnValue(subject);

        fixture.detectChanges(); // Triggers ngOnInit -> loadTags -> subscribe

        expect(component.loading).toBe(true);
    });

    it('should handle load error', () => {
        tagsServiceSpy.getAllTags.mockReturnValue(throwError(() => new Error('Load error')));
        fixture.detectChanges(); // Triggers ngOnInit -> loadTags -> Error

        expect(component.error).toBe('Failed to load tags');
        expect(component.loading).toBe(false);
    });

    it('should fall back to count when sortBy is falsy in params', () => {
        vi.spyOn(component.table, 'getParams').mockReturnValue({ page: 1, pageSize: 10, sortBy: undefined as any, sortOrder: 'desc', search: '' });
        component.loadTags();
        // It should use 'count' as fallback for sortBy
        expect(tagsServiceSpy.getAllTags).toHaveBeenCalledWith(1, 10, 'count', 'desc', '');
    });

    it('should start edit', () => {
        fixture.detectChanges();
        const tagName = 'Angular';
        component.startEdit(tagName);
        expect(component.editingTag).toBe(tagName);
        expect(component.newTagName).toBe(tagName);
    });

    it('should cancel edit', () => {
        fixture.detectChanges();
        component.editingTag = 'Angular';
        component.newTagName = 'NewName';
        component.cancelEdit();
        expect(component.editingTag).toBeNull();
        expect(component.newTagName).toBe('');
    });

    it('should save rename success', () => {
        fixture.detectChanges();
        const oldName = 'Angular';
        const newName = 'AngularJS';
        component.startEdit(oldName);
        component.newTagName = newName;

        tagsServiceSpy.renameTag.mockReturnValue(of({ success: true }));

        component.saveRename(oldName);

        expect(tagsServiceSpy.renameTag).toHaveBeenCalledWith(oldName, newName);
        expect(component.editingTag).toBeNull();
    });

    it('should handle rename error', () => {
        fixture.detectChanges();
        const oldName = 'Python';

        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => { });
        vi.spyOn(console, 'error').mockImplementation(() => { });

        component.startEdit(oldName);
        component.newTagName = 'PyScript';
        tagsServiceSpy.renameTag.mockReturnValue(throwError(() => new Error('Rename error')));

        component.saveRename(oldName);

        expect(tagsServiceSpy.renameTag).toHaveBeenCalled();
        expect(alertSpy).toHaveBeenCalledWith('Failed to rename tag');
    });

    it('should delete tag confirmed', () => {
        fixture.detectChanges();
        const tagName = 'Python';
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        tagsServiceSpy.deleteTag.mockReturnValue(of({ success: true }));

        component.deleteTag(tagName);

        expect(tagsServiceSpy.deleteTag).toHaveBeenCalledWith(tagName);
        expect(tagsServiceSpy.getAllTags).toHaveBeenCalledTimes(2); // Init + Reload
    });

    it('should cancel delete', () => {
        fixture.detectChanges();
        const tagName = 'Python';
        vi.spyOn(window, 'confirm').mockReturnValue(false);

        component.deleteTag(tagName);

        expect(tagsServiceSpy.deleteTag).not.toHaveBeenCalled();
    });

    it('should not rename if name is same or empty', () => {
        fixture.detectChanges();
        const oldName = 'old';
        component.editingTag = oldName;
        component.newTagName = oldName;

        component.saveRename(oldName);
        expect(component.editingTag).toBeNull();
        expect(tagsServiceSpy.renameTag).not.toHaveBeenCalled();

        component.editingTag = oldName;
        component.newTagName = '';
        component.saveRename(oldName);
        expect(component.editingTag).toBeNull();
        expect(tagsServiceSpy.renameTag).not.toHaveBeenCalled();
    });

    it('should handle delete error', () => {
        fixture.detectChanges();
        const tagName = 'test';
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => { });
        vi.spyOn(console, 'error').mockImplementation(() => { }); // Mock console.error to prevent noise

        tagsServiceSpy.deleteTag.mockReturnValue(throwError(() => new Error('Delete error')));

        component.deleteTag(tagName);
        expect(tagsServiceSpy.deleteTag).toHaveBeenCalledWith(tagName);
        expect(alertSpy).toHaveBeenCalledWith('Failed to delete tag');
        expect(tagsServiceSpy.getAllTags).toHaveBeenCalledTimes(1); // Only initial load, no reload on error
    });
});
