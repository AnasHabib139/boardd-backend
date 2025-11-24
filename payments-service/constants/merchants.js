"use strict";

/**
 * Stripe Issuing Merchant Category Codes (MCC)
 * Complete list of valid category codes for spending controls
 * Source: Stripe API - allowed_categories enum
 */

const MERCHANTS = [
  // A
  { code: "ac_refrigeration_repair", name: "AC & Refrigeration Repair", description: "Air conditioning and refrigeration repair services" },
  { code: "accounting_bookkeeping_services", name: "Accounting & Bookkeeping", description: "Accounting, bookkeeping, and tax services" },
  { code: "advertising_services", name: "Advertising Services", description: "Advertising and marketing services" },
  { code: "agricultural_cooperative", name: "Agricultural Cooperative", description: "Agricultural cooperatives" },
  { code: "airlines_air_carriers", name: "Airlines", description: "Airlines and air carriers" },
  { code: "airports_flying_fields", name: "Airports", description: "Airports and flying fields" },
  { code: "ambulance_services", name: "Ambulance Services", description: "Ambulance and emergency transport" },
  { code: "amusement_parks_carnivals", name: "Amusement Parks", description: "Amusement parks and carnivals" },
  { code: "antique_reproductions", name: "Antique Reproductions", description: "Antique reproduction stores" },
  { code: "antique_shops", name: "Antique Shops", description: "Antique shops and dealers" },
  { code: "aquariums", name: "Aquariums", description: "Aquariums and marine exhibits" },
  { code: "architectural_surveying_services", name: "Architectural Services", description: "Architectural and surveying services" },
  { code: "art_dealers_and_galleries", name: "Art Dealers & Galleries", description: "Art dealers and galleries" },
  { code: "artists_supply_and_craft_shops", name: "Art Supplies & Crafts", description: "Artists supply and craft shops" },
  { code: "auto_and_home_supply_stores", name: "Auto & Home Supply", description: "Auto and home supply stores" },
  { code: "auto_body_repair_shops", name: "Auto Body Repair", description: "Auto body repair shops" },
  { code: "auto_paint_shops", name: "Auto Paint Shops", description: "Auto paint shops" },
  { code: "auto_service_shops", name: "Auto Service Shops", description: "General auto service and repair" },
  { code: "automated_cash_disburse", name: "ATM Cash Withdrawal", description: "Automated cash disbursements (ATMs)" },
  { code: "automated_fuel_dispensers", name: "Fuel Dispensers", description: "Automated fuel dispensers" },
  { code: "automobile_associations", name: "Automobile Associations", description: "Automobile associations (AAA, etc.)" },
  { code: "automotive_parts_and_accessories_stores", name: "Auto Parts & Accessories", description: "Automotive parts and accessories stores" },
  { code: "automotive_tire_stores", name: "Tire Stores", description: "Automotive tire stores" },

  // B
  { code: "bail_and_bond_payments", name: "Bail & Bond Payments", description: "Bail and bond payments" },
  { code: "bakeries", name: "Bakeries", description: "Bakeries" },
  { code: "bands_orchestras", name: "Bands & Orchestras", description: "Bands, orchestras, entertainers" },
  { code: "barber_and_beauty_shops", name: "Barber & Beauty Shops", description: "Barber and beauty shops" },
  { code: "betting_casino_gambling", name: "Betting & Gambling", description: "Betting, casino gambling" },
  { code: "bicycle_shops", name: "Bicycle Shops", description: "Bicycle shops, sales and service" },
  { code: "billiard_pool_establishments", name: "Billiard & Pool", description: "Billiard and pool establishments" },
  { code: "boat_dealers", name: "Boat Dealers", description: "Boat dealers" },
  { code: "boat_rentals_and_leases", name: "Boat Rentals", description: "Boat rentals and leases" },
  { code: "book_stores", name: "Book Stores", description: "Book stores" },
  { code: "books_periodicals_and_newspapers", name: "Books & Newspapers", description: "Books, periodicals, and newspapers" },
  { code: "bowling_alleys", name: "Bowling Alleys", description: "Bowling alleys" },
  { code: "bus_lines", name: "Bus Lines", description: "Bus lines" },
  { code: "business_secretarial_schools", name: "Business Schools", description: "Business and secretarial schools" },
  { code: "buying_shopping_services", name: "Buying & Shopping Services", description: "Buying and shopping services" },

  // C
  { code: "cable_satellite_and_other_pay_television_and_radio", name: "Cable & Satellite TV", description: "Cable, satellite, and pay TV/radio" },
  { code: "camera_and_photographic_supply_stores", name: "Camera Stores", description: "Camera and photographic supply stores" },
  { code: "candy_nut_and_confectionery_stores", name: "Candy & Confectionery", description: "Candy, nut, and confectionery stores" },
  { code: "car_and_truck_dealers_new_used", name: "Car Dealers (New & Used)", description: "Car and truck dealers, new and used" },
  { code: "car_and_truck_dealers_used_only", name: "Car Dealers (Used Only)", description: "Car and truck dealers, used only" },
  { code: "car_rental_agencies", name: "Car Rentals", description: "Car rental agencies" },
  { code: "car_washes", name: "Car Washes", description: "Car washes" },
  { code: "carpentry_services", name: "Carpentry Services", description: "Carpentry services" },
  { code: "carpet_upholstery_cleaning", name: "Carpet Cleaning", description: "Carpet and upholstery cleaning" },
  { code: "caterers", name: "Caterers", description: "Caterers" },
  { code: "charitable_and_social_service_organizations_fundraising", name: "Charitable Organizations", description: "Charitable and social service organizations" },
  { code: "chemicals_and_allied_products", name: "Chemicals", description: "Chemicals and allied products" },
  { code: "child_care_services", name: "Child Care", description: "Child care services" },
  { code: "childrens_and_infants_wear_stores", name: "Children's Clothing", description: "Children's and infants' wear stores" },
  { code: "chiropodists_podiatrists", name: "Podiatrists", description: "Chiropodists and podiatrists" },
  { code: "chiropractors", name: "Chiropractors", description: "Chiropractors" },
  { code: "cigar_stores_and_stands", name: "Cigar Stores", description: "Cigar stores and stands" },
  { code: "civic_social_fraternal_associations", name: "Civic Associations", description: "Civic, social, fraternal associations" },
  { code: "cleaning_and_maintenance", name: "Cleaning & Maintenance", description: "Cleaning and maintenance services" },
  { code: "clothing_rental", name: "Clothing Rental", description: "Clothing rental" },
  { code: "colleges_universities", name: "Colleges & Universities", description: "Colleges and universities" },
  { code: "commercial_equipment", name: "Commercial Equipment", description: "Commercial equipment" },
  { code: "commercial_footwear", name: "Commercial Footwear", description: "Commercial footwear" },
  { code: "commercial_photography_art_and_graphics", name: "Commercial Photography", description: "Commercial photography, art, and graphics" },
  { code: "commuter_transport_and_ferries", name: "Commuter Transport", description: "Commuter transport and ferries" },
  { code: "computer_network_services", name: "Computer Network Services", description: "Computer network services" },
  { code: "computer_programming", name: "Computer Programming", description: "Computer programming" },
  { code: "computer_repair", name: "Computer Repair", description: "Computer repair" },
  { code: "computer_software_stores", name: "Software Stores", description: "Computer software stores" },
  { code: "computers_peripherals_and_software", name: "Computers & Software", description: "Computers, peripherals, and software" },
  { code: "concrete_work_services", name: "Concrete Work", description: "Concrete work services" },
  { code: "construction_materials", name: "Construction Materials", description: "Construction materials" },
  { code: "consulting_public_relations", name: "Consulting & PR", description: "Consulting and public relations" },
  { code: "correspondence_schools", name: "Correspondence Schools", description: "Correspondence schools" },
  { code: "cosmetic_stores", name: "Cosmetic Stores", description: "Cosmetic stores" },
  { code: "counseling_services", name: "Counseling Services", description: "Counseling services" },
  { code: "country_clubs", name: "Country Clubs", description: "Country clubs" },
  { code: "courier_services", name: "Courier Services", description: "Courier services" },
  { code: "court_costs", name: "Court Costs", description: "Court costs and legal fees" },
  { code: "credit_reporting_agencies", name: "Credit Reporting", description: "Credit reporting agencies" },
  { code: "cruise_lines", name: "Cruise Lines", description: "Cruise lines" },

  // D
  { code: "dairy_products_stores", name: "Dairy Products", description: "Dairy products stores" },
  { code: "dance_hall_studios_schools", name: "Dance Studios", description: "Dance halls, studios, and schools" },
  { code: "dating_escort_services", name: "Dating Services", description: "Dating and escort services" },
  { code: "dentists_orthodontists", name: "Dentists", description: "Dentists and orthodontists" },
  { code: "department_stores", name: "Department Stores", description: "Department stores" },
  { code: "detective_agencies", name: "Detective Agencies", description: "Detective agencies" },
  { code: "digital_goods_applications", name: "Digital Apps", description: "Digital goods - applications" },
  { code: "digital_goods_games", name: "Digital Games", description: "Digital goods - games" },
  { code: "digital_goods_large_volume", name: "Digital Goods (Large)", description: "Digital goods - large volume" },
  { code: "digital_goods_media", name: "Digital Media", description: "Digital goods - media" },
  { code: "direct_marketing_catalog_merchant", name: "Catalog Marketing", description: "Direct marketing - catalog merchant" },
  { code: "direct_marketing_combination_catalog_and_retail_merchant", name: "Catalog & Retail", description: "Direct marketing - combination catalog and retail" },
  { code: "direct_marketing_inbound_telemarketing", name: "Inbound Telemarketing", description: "Direct marketing - inbound telemarketing" },
  { code: "direct_marketing_insurance_services", name: "Insurance Marketing", description: "Direct marketing - insurance services" },
  { code: "direct_marketing_other", name: "Other Direct Marketing", description: "Direct marketing - other" },
  { code: "direct_marketing_outbound_telemarketing", name: "Outbound Telemarketing", description: "Direct marketing - outbound telemarketing" },
  { code: "direct_marketing_subscription", name: "Subscription Marketing", description: "Direct marketing - subscription" },
  { code: "direct_marketing_travel", name: "Travel Marketing", description: "Direct marketing - travel" },
  { code: "discount_stores", name: "Discount Stores", description: "Discount stores" },
  { code: "doctors", name: "Doctors", description: "Doctors and physicians" },
  { code: "door_to_door_sales", name: "Door-to-Door Sales", description: "Door-to-door sales" },
  { code: "drapery_window_covering_and_upholstery_stores", name: "Drapery & Window Covering", description: "Drapery, window covering, and upholstery" },
  { code: "drinking_places", name: "Bars & Drinking Places", description: "Drinking places, bars, taverns" },
  { code: "drug_stores_and_pharmacies", name: "Drug Stores & Pharmacies", description: "Drug stores and pharmacies" },
  { code: "drugs_drug_proprietaries_and_druggist_sundries", name: "Drugs & Sundries", description: "Drugs, drug proprietaries, and druggist sundries" },
  { code: "dry_cleaners", name: "Dry Cleaners", description: "Dry cleaners" },
  { code: "durable_goods", name: "Durable Goods", description: "Durable goods" },
  { code: "duty_free_stores", name: "Duty Free Stores", description: "Duty free stores" },

  // E
  { code: "eating_places_restaurants", name: "Restaurants", description: "Eating places, restaurants" },
  { code: "educational_services", name: "Educational Services", description: "Educational services" },
  { code: "electric_razor_stores", name: "Electric Razor Stores", description: "Electric razor stores" },
  { code: "electric_vehicle_charging", name: "EV Charging", description: "Electric vehicle charging" },
  { code: "electrical_parts_and_equipment", name: "Electrical Parts", description: "Electrical parts and equipment" },
  { code: "electrical_services", name: "Electrical Services", description: "Electrical services" },
  { code: "electronics_repair_shops", name: "Electronics Repair", description: "Electronics repair shops" },
  { code: "electronics_stores", name: "Electronics Stores", description: "Electronics stores" },
  { code: "elementary_secondary_schools", name: "Schools", description: "Elementary and secondary schools" },
  { code: "emergency_services_gcas_visa_use_only", name: "Emergency Services", description: "Emergency services (GCAS/Visa use only)" },
  { code: "employment_temp_agencies", name: "Employment Agencies", description: "Employment and temp agencies" },
  { code: "equipment_rental", name: "Equipment Rental", description: "Equipment rental" },
  { code: "exterminating_services", name: "Exterminating Services", description: "Exterminating services" },

  // F
  { code: "family_clothing_stores", name: "Family Clothing", description: "Family clothing stores" },
  { code: "fast_food_restaurants", name: "Fast Food", description: "Fast food restaurants" },
  { code: "financial_institutions", name: "Financial Institutions", description: "Financial institutions" },
  { code: "fines_government_administrative_entities", name: "Government Fines", description: "Fines - government administrative entities" },
  { code: "fireplace_fireplace_screens_and_accessories_stores", name: "Fireplace Stores", description: "Fireplace and accessories stores" },
  { code: "floor_covering_stores", name: "Floor Covering", description: "Floor covering stores" },
  { code: "florists", name: "Florists", description: "Florists" },
  { code: "florists_supplies_nursery_stock_and_flowers", name: "Florist Supplies", description: "Florists supplies, nursery stock, and flowers" },
  { code: "freezer_and_locker_meat_provisioners", name: "Freezer & Locker Meat", description: "Freezer and locker meat provisioners" },
  { code: "fuel_dealers_non_automotive", name: "Fuel Dealers", description: "Fuel dealers (non-automotive)" },
  { code: "funeral_services_crematories", name: "Funeral Services", description: "Funeral services and crematories" },
  { code: "furniture_home_furnishings_and_equipment_stores_except_appliances", name: "Furniture Stores", description: "Furniture and home furnishings stores" },
  { code: "furniture_repair_refinishing", name: "Furniture Repair", description: "Furniture repair and refinishing" },
  { code: "furriers_and_fur_shops", name: "Furriers", description: "Furriers and fur shops" },

  // G
  { code: "general_services", name: "General Services", description: "General services" },
  { code: "gift_card_novelty_and_souvenir_shops", name: "Gift & Souvenir Shops", description: "Gift, card, novelty, and souvenir shops" },
  { code: "glass_paint_and_wallpaper_stores", name: "Glass & Paint Stores", description: "Glass, paint, and wallpaper stores" },
  { code: "glassware_crystal_stores", name: "Glassware & Crystal", description: "Glassware and crystal stores" },
  { code: "golf_courses_public", name: "Golf Courses", description: "Golf courses (public)" },
  { code: "government_licensed_horse_dog_racing_us_region_only", name: "Horse/Dog Racing (US)", description: "Government licensed horse/dog racing (US only)" },
  { code: "government_licensed_online_casions_online_gambling_us_region_only", name: "Online Gambling (US)", description: "Government licensed online casinos/gambling (US only)" },
  { code: "government_owned_lotteries_non_us_region", name: "Lotteries (Non-US)", description: "Government owned lotteries (non-US)" },
  { code: "government_owned_lotteries_us_region_only", name: "Lotteries (US)", description: "Government owned lotteries (US only)" },
  { code: "government_services", name: "Government Services", description: "Government services" },
  { code: "grocery_stores_supermarkets", name: "Grocery Stores", description: "Grocery stores and supermarkets" },

  // H
  { code: "hardware_equipment_and_supplies", name: "Hardware & Equipment", description: "Hardware, equipment, and supplies" },
  { code: "hardware_stores", name: "Hardware Stores", description: "Hardware stores" },
  { code: "health_and_beauty_spas", name: "Health & Beauty Spas", description: "Health and beauty spas" },
  { code: "hearing_aids_sales_and_supplies", name: "Hearing Aids", description: "Hearing aids sales and supplies" },
  { code: "heating_plumbing_a_c", name: "Heating, Plumbing & AC", description: "Heating, plumbing, and air conditioning" },
  { code: "hobby_toy_and_game_shops", name: "Hobby & Toy Shops", description: "Hobby, toy, and game shops" },
  { code: "home_supply_warehouse_stores", name: "Home Supply Warehouse", description: "Home supply warehouse stores" },
  { code: "hospitals", name: "Hospitals", description: "Hospitals" },
  { code: "hotels_motels_and_resorts", name: "Hotels & Resorts", description: "Hotels, motels, and resorts" },
  { code: "household_appliance_stores", name: "Appliance Stores", description: "Household appliance stores" },

  // I
  { code: "industrial_supplies", name: "Industrial Supplies", description: "Industrial supplies" },
  { code: "information_retrieval_services", name: "Information Services", description: "Information retrieval services" },
  { code: "insurance_default", name: "Insurance (Default)", description: "Insurance - default" },
  { code: "insurance_underwriting_premiums", name: "Insurance Premiums", description: "Insurance underwriting and premiums" },
  { code: "intra_company_purchases", name: "Intra-Company Purchases", description: "Intra-company purchases" },

  // J
  { code: "jewelry_stores_watches_clocks_and_silverware_stores", name: "Jewelry Stores", description: "Jewelry, watches, clocks, and silverware stores" },

  // L
  { code: "landscaping_services", name: "Landscaping", description: "Landscaping services" },
  { code: "laundries", name: "Laundries", description: "Laundries" },
  { code: "laundry_cleaning_services", name: "Laundry & Cleaning", description: "Laundry and cleaning services" },
  { code: "legal_services_attorneys", name: "Legal Services", description: "Legal services and attorneys" },
  { code: "luggage_and_leather_goods_stores", name: "Luggage & Leather Goods", description: "Luggage and leather goods stores" },
  { code: "lumber_building_materials_stores", name: "Lumber & Building Materials", description: "Lumber and building materials stores" },

  // M
  { code: "manual_cash_disburse", name: "Manual Cash Disbursement", description: "Manual cash disbursement" },
  { code: "marinas_service_and_supplies", name: "Marinas", description: "Marinas, service and supplies" },
  { code: "marketplaces", name: "Marketplaces", description: "Marketplaces" },
  { code: "masonry_stonework_and_plaster", name: "Masonry & Stonework", description: "Masonry, stonework, and plaster" },
  { code: "massage_parlors", name: "Massage Parlors", description: "Massage parlors" },
  { code: "medical_and_dental_labs", name: "Medical & Dental Labs", description: "Medical and dental labs" },
  { code: "medical_dental_ophthalmic_and_hospital_equipment_and_supplies", name: "Medical Equipment", description: "Medical, dental, ophthalmic equipment and supplies" },
  { code: "medical_services", name: "Medical Services", description: "Medical services" },
  { code: "membership_organizations", name: "Membership Organizations", description: "Membership organizations" },
  { code: "mens_and_boys_clothing_and_accessories_stores", name: "Men's Clothing", description: "Men's and boys' clothing and accessories" },
  { code: "mens_womens_clothing_stores", name: "Clothing Stores", description: "Men's and women's clothing stores" },
  { code: "metal_service_centers", name: "Metal Service Centers", description: "Metal service centers" },
  { code: "miscellaneous", name: "Miscellaneous", description: "Miscellaneous" },
  { code: "miscellaneous_apparel_and_accessory_shops", name: "Apparel & Accessories", description: "Miscellaneous apparel and accessory shops" },
  { code: "miscellaneous_auto_dealers", name: "Auto Dealers (Misc)", description: "Miscellaneous auto dealers" },
  { code: "miscellaneous_business_services", name: "Business Services (Misc)", description: "Miscellaneous business services" },
  { code: "miscellaneous_food_stores", name: "Food Stores (Misc)", description: "Miscellaneous food stores" },
  { code: "miscellaneous_general_merchandise", name: "General Merchandise", description: "Miscellaneous general merchandise" },
  { code: "miscellaneous_general_services", name: "General Services (Misc)", description: "Miscellaneous general services" },
  { code: "miscellaneous_home_furnishing_specialty_stores", name: "Home Furnishing (Misc)", description: "Miscellaneous home furnishing specialty stores" },
  { code: "miscellaneous_publishing_and_printing", name: "Publishing & Printing", description: "Miscellaneous publishing and printing" },
  { code: "miscellaneous_recreation_services", name: "Recreation Services", description: "Miscellaneous recreation services" },
  { code: "miscellaneous_repair_shops", name: "Repair Shops (Misc)", description: "Miscellaneous repair shops" },
  { code: "miscellaneous_specialty_retail", name: "Specialty Retail", description: "Miscellaneous specialty retail" },
  { code: "mobile_home_dealers", name: "Mobile Home Dealers", description: "Mobile home dealers" },
  { code: "motion_picture_theaters", name: "Movie Theaters", description: "Motion picture theaters" },
  { code: "motor_freight_carriers_and_trucking", name: "Trucking", description: "Motor freight carriers and trucking" },
  { code: "motor_homes_dealers", name: "Motor Homes Dealers", description: "Motor homes dealers" },
  { code: "motor_vehicle_supplies_and_new_parts", name: "Vehicle Supplies & Parts", description: "Motor vehicle supplies and new parts" },
  { code: "motorcycle_shops_and_dealers", name: "Motorcycle Shops", description: "Motorcycle shops and dealers" },
  { code: "motorcycle_shops_dealers", name: "Motorcycle Dealers", description: "Motorcycle shops and dealers" },
  { code: "music_stores_musical_instruments_pianos_and_sheet_music", name: "Music Stores", description: "Music stores, instruments, pianos, sheet music" },

  // N
  { code: "news_dealers_and_newsstands", name: "Newsstands", description: "News dealers and newsstands" },
  { code: "non_fi_money_orders", name: "Money Orders (Non-FI)", description: "Non-financial institution money orders" },
  { code: "non_fi_stored_value_card_purchase_load", name: "Stored Value Cards", description: "Non-FI stored value card purchase/load" },
  { code: "nondurable_goods", name: "Nondurable Goods", description: "Nondurable goods" },
  { code: "nurseries_lawn_and_garden_supply_stores", name: "Nurseries & Garden Supply", description: "Nurseries, lawn and garden supply stores" },
  { code: "nursing_personal_care", name: "Nursing & Personal Care", description: "Nursing and personal care" },

  // O
  { code: "office_and_commercial_furniture", name: "Office Furniture", description: "Office and commercial furniture" },
  { code: "opticians_eyeglasses", name: "Opticians & Eyeglasses", description: "Opticians and eyeglasses" },
  { code: "optometrists_ophthalmologist", name: "Optometrists", description: "Optometrists and ophthalmologists" },
  { code: "orthopedic_goods_prosthetic_devices", name: "Orthopedic Goods", description: "Orthopedic goods and prosthetic devices" },
  { code: "osteopaths", name: "Osteopaths", description: "Osteopaths" },

  // P
  { code: "package_stores_beer_wine_and_liquor", name: "Liquor Stores", description: "Package stores - beer, wine, and liquor" },
  { code: "paints_varnishes_and_supplies", name: "Paints & Supplies", description: "Paints, varnishes, and supplies" },
  { code: "parking_lots_garages", name: "Parking", description: "Parking lots and garages" },
  { code: "passenger_railways", name: "Railways", description: "Passenger railways" },
  { code: "pawn_shops", name: "Pawn Shops", description: "Pawn shops" },
  { code: "pet_shops_pet_food_and_supplies", name: "Pet Shops", description: "Pet shops, pet food, and supplies" },
  { code: "petroleum_and_petroleum_products", name: "Petroleum Products", description: "Petroleum and petroleum products" },
  { code: "photo_developing", name: "Photo Developing", description: "Photo developing" },
  { code: "photographic_photocopy_microfilm_equipment_and_supplies", name: "Photographic Equipment", description: "Photographic, photocopy, microfilm equipment" },
  { code: "photographic_studios", name: "Photo Studios", description: "Photographic studios" },
  { code: "picture_video_production", name: "Video Production", description: "Picture and video production" },
  { code: "piece_goods_notions_and_other_dry_goods", name: "Dry Goods", description: "Piece goods, notions, and other dry goods" },
  { code: "plumbing_heating_equipment_and_supplies", name: "Plumbing & Heating", description: "Plumbing and heating equipment and supplies" },
  { code: "political_organizations", name: "Political Organizations", description: "Political organizations" },
  { code: "postal_services_government_only", name: "Postal Services", description: "Postal services (government only)" },
  { code: "precious_stones_and_metals_watches_and_jewelry", name: "Precious Stones & Metals", description: "Precious stones and metals, watches and jewelry" },
  { code: "professional_services", name: "Professional Services", description: "Professional services" },
  { code: "public_warehousing_and_storage", name: "Warehousing & Storage", description: "Public warehousing and storage" },

  // Q
  { code: "quick_copy_repro_and_blueprint", name: "Quick Copy & Blueprint", description: "Quick copy, repro, and blueprint" },

  // R
  { code: "railroads", name: "Railroads", description: "Railroads" },
  { code: "real_estate_agents_and_managers_rentals", name: "Real Estate", description: "Real estate agents and managers, rentals" },
  { code: "record_stores", name: "Record Stores", description: "Record stores" },
  { code: "recreational_vehicle_rentals", name: "RV Rentals", description: "Recreational vehicle rentals" },
  { code: "religious_goods_stores", name: "Religious Goods", description: "Religious goods stores" },
  { code: "religious_organizations", name: "Religious Organizations", description: "Religious organizations" },
  { code: "roofing_siding_sheet_metal", name: "Roofing & Siding", description: "Roofing, siding, sheet metal" },

  // S
  { code: "secretarial_support_services", name: "Secretarial Services", description: "Secretarial support services" },
  { code: "security_brokers_dealers", name: "Security Brokers", description: "Security brokers and dealers" },
  { code: "service_stations", name: "Gas Stations", description: "Service stations (gas stations)" },
  { code: "sewing_needlework_fabric_and_piece_goods_stores", name: "Sewing & Fabric Stores", description: "Sewing, needlework, fabric, and piece goods stores" },
  { code: "shoe_repair_hat_cleaning", name: "Shoe Repair", description: "Shoe repair and hat cleaning" },
  { code: "shoe_stores", name: "Shoe Stores", description: "Shoe stores" },
  { code: "small_appliance_repair", name: "Small Appliance Repair", description: "Small appliance repair" },
  { code: "snowmobile_dealers", name: "Snowmobile Dealers", description: "Snowmobile dealers" },
  { code: "special_trade_services", name: "Special Trade Services", description: "Special trade services" },
  { code: "specialty_cleaning", name: "Specialty Cleaning", description: "Specialty cleaning" },
  { code: "sporting_goods_stores", name: "Sporting Goods", description: "Sporting goods stores" },
  { code: "sporting_recreation_camps", name: "Recreation Camps", description: "Sporting and recreation camps" },
  { code: "sports_and_riding_apparel_stores", name: "Sports Apparel", description: "Sports and riding apparel stores" },
  { code: "sports_clubs_fields", name: "Sports Clubs & Fields", description: "Sports clubs and fields" },
  { code: "stamp_and_coin_stores", name: "Stamp & Coin Stores", description: "Stamp and coin stores" },
  { code: "stationary_office_supplies_printing_and_writing_paper", name: "Office Supplies", description: "Stationery, office supplies, printing paper" },
  { code: "stationery_stores_office_and_school_supply_stores", name: "Stationery Stores", description: "Stationery stores, office and school supply" },
  { code: "swimming_pools_sales", name: "Swimming Pools", description: "Swimming pools sales" },

  // T
  { code: "t_ui_travel_germany", name: "Travel (Germany)", description: "T-UI Travel - Germany" },
  { code: "tailors_alterations", name: "Tailors & Alterations", description: "Tailors and alterations" },
  { code: "tax_payments_government_agencies", name: "Tax Payments", description: "Tax payments - government agencies" },
  { code: "tax_preparation_services", name: "Tax Preparation", description: "Tax preparation services" },
  { code: "taxicabs_limousines", name: "Taxis & Limos", description: "Taxicabs and limousines" },
  { code: "telecommunication_equipment_and_telephone_sales", name: "Telecom Equipment", description: "Telecommunication equipment and telephone sales" },
  { code: "telecommunication_services", name: "Telecom Services", description: "Telecommunication services" },
  { code: "telegraph_services", name: "Telegraph Services", description: "Telegraph services" },
  { code: "tent_and_awning_shops", name: "Tent & Awning Shops", description: "Tent and awning shops" },
  { code: "testing_laboratories", name: "Testing Labs", description: "Testing laboratories" },
  { code: "theatrical_ticket_agencies", name: "Ticket Agencies", description: "Theatrical ticket agencies" },
  { code: "timeshares", name: "Timeshares", description: "Timeshares" },
  { code: "tire_retreading_and_repair", name: "Tire Repair", description: "Tire retreading and repair" },
  { code: "tolls_bridge_fees", name: "Tolls & Bridge Fees", description: "Tolls and bridge fees" },
  { code: "tourist_attractions_and_exhibits", name: "Tourist Attractions", description: "Tourist attractions and exhibits" },
  { code: "towing_services", name: "Towing Services", description: "Towing services" },
  { code: "trailer_parks_campgrounds", name: "Trailer Parks", description: "Trailer parks and campgrounds" },
  { code: "transportation_services", name: "Transportation Services", description: "Transportation services" },
  { code: "travel_agencies_tour_operators", name: "Travel Agencies", description: "Travel agencies and tour operators" },
  { code: "truck_stop_iteration", name: "Truck Stops", description: "Truck stops" },
  { code: "truck_utility_trailer_rentals", name: "Truck & Trailer Rentals", description: "Truck and utility trailer rentals" },
  { code: "typesetting_plate_making_and_related_services", name: "Typesetting", description: "Typesetting, plate making, and related services" },
  { code: "typewriter_stores", name: "Typewriter Stores", description: "Typewriter stores" },

  // U
  { code: "u_s_federal_government_agencies_or_departments", name: "US Federal Government", description: "US federal government agencies or departments" },
  { code: "uniforms_commercial_clothing", name: "Uniforms", description: "Uniforms and commercial clothing" },
  { code: "used_merchandise_and_secondhand_stores", name: "Used Merchandise", description: "Used merchandise and secondhand stores" },
  { code: "utilities", name: "Utilities", description: "Utilities" },

  // V
  { code: "variety_stores", name: "Variety Stores", description: "Variety stores" },
  { code: "veterinary_services", name: "Veterinary Services", description: "Veterinary services" },
  { code: "video_amusement_game_supplies", name: "Video Game Supplies", description: "Video amusement game supplies" },
  { code: "video_game_arcades", name: "Video Game Arcades", description: "Video game arcades" },
  { code: "video_tape_rental_stores", name: "Video Rental", description: "Video tape rental stores" },
  { code: "vocational_trade_schools", name: "Vocational Schools", description: "Vocational and trade schools" },

  // W
  { code: "watch_jewelry_repair", name: "Watch & Jewelry Repair", description: "Watch and jewelry repair" },
  { code: "welding_repair", name: "Welding Repair", description: "Welding repair" },
  { code: "wholesale_clubs", name: "Wholesale Clubs", description: "Wholesale clubs" },
  { code: "wig_and_toupee_stores", name: "Wig Stores", description: "Wig and toupee stores" },
  { code: "wires_money_orders", name: "Wire Money Orders", description: "Wires and money orders" },
  { code: "womens_accessory_and_specialty_shops", name: "Women's Accessories", description: "Women's accessory and specialty shops" },
  { code: "womens_ready_to_wear_stores", name: "Women's Clothing", description: "Women's ready-to-wear stores" },
  { code: "wrecking_and_salvage_yards", name: "Wrecking & Salvage", description: "Wrecking and salvage yards" }
];

/**
 * Get all merchants
 * @returns {Array} List of all merchant codes
 */
exports.getAllMerchants = () => {
  return MERCHANTS.map(m => ({
    code: m.code,
    name: m.name,
    description: m.description
  }));
};

/**
 * Get merchant by code
 * @param {string} code - Merchant code
 * @returns {object|null} Merchant object or null
 */
exports.getMerchantByCode = (code) => {
  return MERCHANTS.find(m => m.code === code) || null;
};

/**
 * Validate merchant codes
 * @param {Array} codes - Array of merchant codes to validate
 * @returns {object} { valid: boolean, invalidCodes: Array }
 */
exports.validateMerchantCodes = (codes) => {
  const validCodes = MERCHANTS.map(m => m.code);
  const invalidCodes = codes.filter(code => !validCodes.includes(code));

  return {
    valid: invalidCodes.length === 0,
    invalidCodes
  };
};

/**
 * Search merchants by name
 * @param {string} query - Search query
 * @returns {Array} Matching merchants
 */
exports.searchMerchants = (query) => {
  const lowerQuery = query.toLowerCase();
  return MERCHANTS.filter(m =>
    m.name.toLowerCase().includes(lowerQuery) ||
    m.description.toLowerCase().includes(lowerQuery) ||
    m.code.toLowerCase().includes(lowerQuery)
  ).map(m => ({
    code: m.code,
    name: m.name,
    description: m.description
  }));
};

// Export raw data for direct access if needed
exports.MERCHANTS = MERCHANTS;
