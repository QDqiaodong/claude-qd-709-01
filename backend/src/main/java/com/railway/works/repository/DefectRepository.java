package com.railway.works.repository;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.railway.works.domain.Defect;

public interface DefectRepository extends JpaRepository<Defect, Long> {

    List<Defect> findAllByOrderByFoundDateDesc();

    List<Defect> findAllBySectionIdOrderByMileageAsc(Long sectionId);

    List<Defect> findAllByInspectionIdOrderByMileageAsc(Long inspectionId);

    /**
     * 区段、严重等级、销号状态三个条件可任意组合；参数为 null 时该条件不参与过滤
     * （未选区段即查全线路）。统一按发现日期倒序，保证各组合下排序一致。
     */
    @Query("""
            select d from Defect d
            where (:sectionId is null or d.sectionId = :sectionId)
              and (:severity is null or d.severity = :severity)
              and (:closed is null or d.closed = :closed)
            order by d.foundDate desc, d.id desc
            """)
    List<Defect> search(@Param("sectionId") Long sectionId,
                        @Param("severity") String severity,
                        @Param("closed") Boolean closed);
}
